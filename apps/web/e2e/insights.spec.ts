import { expect, test, type APIRequestContext, type BrowserContextOptions } from "@playwright/test";
import { api, apiClient, arrive, audit, sessionToken, sql, STACK } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;

const marker = () =>
  `[${test.info().parallelIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}]`;

async function program(
  match: string,
  plan: { content?: unknown; sequence?: unknown[]; status?: number },
) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ match, ...plan }),
  });
  expect(res.ok).toBe(true);
}

const PROFILE = {
  summary: "A ripe, structured Bordeaux with plenty of life ahead.",
  style: "Full-bodied red",
  grapes: ["Merlot", "Cabernet Franc"],
  tasting: "Plum, cedar and a little graphite.",
  serving_temp_min_c: 16,
  serving_temp_max_c: 18,
  decant_minutes: 45,
  abv_percent: 13.5,
  pairings: ["Roast lamb", "Hard cheese"],
  aging: "Should keep improving for another ten years.",
  value_low: 40,
  value_high: 60,
  value_basis: "Based on what recent vintages of this estate sell for.",
  drink_from_year: 2022,
  drink_until_year: 2040,
  country_code: "FR",
  region: "Bordeaux",
  appellation: "Pauillac",
  confidence: "medium",
};

async function furnish(
  request: APIRequestContext,
  email: string,
  m: string,
  quantity = 2,
): Promise<{ wineId: string; vintageId: string; bottleIds: string[]; token: string }> {
  const { call, token } = await apiClient(request, email);
  const wine = (
    await call<{ id: string }>(
      "post",
      "/wines",
      {
        producer: "Insight Estate",
        name: `Wine ${m}`,
        type: "red",
        countryCode: "FR",
        region: "Bordeaux",
      },
      201,
    )
  ).body;
  const added = (
    await call<{ bottleIds: string[] }>(
      "post",
      "/bottles",
      { wineId: wine.id, year: 2015, quantity, locationId: null, priceCents: 3000 },
      201,
    )
  ).body;
  const [vintage] = await sql<{ id: string }>(
    "select id from public.wine_vintages where wine_id = $1",
    [wine.id],
  );
  return { wineId: wine.id, vintageId: vintage!.id, bottleIds: added.bottleIds, token };
}

test.describe("a wine's profile", () => {
  test("ask the AI, see it as an estimate with a value, and set your own", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "insight");
    const m = marker();
    const { vintageId } = await furnish(request, email, m);
    await program(m, { content: PROFILE });

    await page.goto(`/cellar/${vintageId}`);
    await expect(page.getByTestId("worth")).toHaveCount(0);
    await page.getByRole("button", { name: "Tell me about this wine" }).click();

    const card = page.getByTestId("insight");
    await expect(card.getByText(PROFILE.summary)).toBeVisible();
    await expect(card.getByText("Merlot, Cabernet Franc")).toBeVisible();
    await expect(card.getByText("16–18 °C")).toBeVisible();
    await expect(card.getByText(/an estimate, not a fact/)).toBeVisible();
    // Half way between 40 and 60
    await expect(page.getByTestId("worth")).toContainText(/50[.,]00/);
    await expect(page.getByTestId("value")).toContainText("AI estimate");
    // The drinking window now comes from the AI, and the page says so
    await expect(page.getByText(/An estimate by the AI/)).toBeVisible();
    await page.screenshot({ path: shot(`insight-${project()}`), fullPage: true });
    expect(await audit(page)).toEqual([]);

    // Kept: no second call after a reload.
    await expect(page.getByTestId("insight").getByText(PROFILE.summary)).toBeVisible();

    // Own value wins over the estimate.
    await page.getByRole("button", { name: "Enter my own value" }).click();
    await page.getByLabel(/What is one bottle worth now/).fill("70");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("worth")).toContainText(/70[.,]00/);
    await expect(page.getByTestId("value")).toContainText("Your own value.");
    await page.getByRole("button", { name: "Change my value" }).click();
    await page.getByRole("button", { name: "Use the estimate instead" }).click();
    await expect(page.getByTestId("worth")).toContainText(/50[.,]00/);

    const calls = await (
      await fetch(`${STACK}/__test/openai/calls?match=${encodeURIComponent(m)}`)
    ).json();
    expect((calls as { calls: unknown[] }).calls).toHaveLength(1);
  });

  test("when the AI can't, nothing is stored and the person is told kindly", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "insightfail");
    const m = marker();
    const { vintageId } = await furnish(request, email, m);
    await program(m, { status: 500 });

    await page.goto(`/cellar/${vintageId}`);
    await page.getByRole("button", { name: "Tell me about this wine" }).click();
    await expect(page.getByTestId("insight").getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tell me about this wine" })).toBeVisible();
    expect(
      await sql("select 1 from public.vintage_insights where vintage_id = $1", [vintageId]),
    ).toHaveLength(0);
  });

  test("an implausible value from the AI is thrown away, the rest is kept", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "insightabsurd");
    const m = marker();
    const { vintageId } = await furnish(request, email, m);
    await program(m, { content: { ...PROFILE, value_low: 5, value_high: 5000 } });

    await page.goto(`/cellar/${vintageId}`);
    await page.getByRole("button", { name: "Tell me about this wine" }).click();
    await expect(page.getByTestId("insight").getByText(PROFILE.summary)).toBeVisible();
    await expect(page.getByTestId("worth")).toHaveCount(0);
    await expect(page.getByTestId("value")).toContainText("No value yet");
  });
});

test.describe("where a bottle came from and what it is kept for", () => {
  test("mark a bottle as a gift for a day, and Home reminds you", async ({ page, request }) => {
    const { email } = await arrive(page, "extras");
    const { vintageId } = await furnish(request, email, marker());
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

    await page.goto(`/cellar/${vintageId}`);
    await page
      .getByRole("button", { name: /^Details of the bottle/ })
      .first()
      .click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("radio", { name: "A gift" }).click();
    await sheet.getByLabel("Who gave it to you?").fill("Oma");
    await sheet.getByLabel("Keeping it for a special moment?").fill("Christmas dinner");
    await sheet.getByLabel("On which day?").fill(soon);
    await page.screenshot({ path: shot(`extras-sheet-${project()}`) });
    await sheet.getByRole("button", { name: "Save" }).click();

    await expect(page.getByTestId("bottle-chips")).toContainText(
      "A gift from Oma · Kept for Christmas dinner",
    );

    await page.goto("/");
    const reminders = page.getByTestId("reminders");
    await expect(reminders).toContainText("Christmas dinner");
    await expect(reminders).toContainText("In 3 days");
    await page.screenshot({ path: shot(`home-reminders-${project()}`), fullPage: true });
    expect(await audit(page)).toEqual([]);

    // A date for the occasion needs the occasion itself; clearing everything takes the reminder away.
    await page.goto(`/cellar/${vintageId}`);
    await page
      .getByRole("button", { name: /^Details of the bottle/ })
      .first()
      .click();
    await page.getByRole("dialog").getByLabel("Keeping it for a special moment?").fill("");
    await page.getByRole("dialog").getByRole("radio", { name: "Not saying" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await page.goto("/");
    await expect(page.getByTestId("reminders")).toHaveCount(0);
  });

  test("tell it while adding bottles, and it is there on the wine", async ({ page, request }) => {
    const { email } = await arrive(page, "extrasadd");
    const m = marker();
    const { wineId, vintageId } = await furnish(request, email, m, 1);

    await page.goto(`/cellar/add?wine=${wineId}&year=2018`);
    await page.getByText("More details").click();
    await page.getByRole("radio", { name: "A gift" }).click();
    await page.getByLabel("Who gave it to you?").fill("Tante Els");
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByRole("heading", { name: "Added to your cellar." })).toBeVisible();

    const [added] = await sql<{ id: string }>(
      "select id from public.wine_vintages where wine_id = $1 and year = 2018",
      [wineId],
    );
    await page.goto(`/cellar/${added!.id}`);
    await expect(page.getByTestId("bottle-chips")).toContainText("A gift from Tante Els");
    void vintageId;
  });

  test("a bought bottle remembers where", async ({ page, request }) => {
    const { email } = await arrive(page, "extrasshop");
    const m = marker();
    const { wineId } = await furnish(request, email, m, 1);
    await page.goto(`/cellar/add?wine=${wineId}&year=2017`);
    await page.getByText("More details").click();
    await page.getByLabel("Bought at").fill("Wijnhandel Vos");
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByRole("heading", { name: "Added to your cellar." })).toBeVisible();
    const rows = await sql<{ purchased_from: string }>(
      "select b.purchased_from from public.bottles b join public.wine_vintages v on v.id = b.vintage_id where v.wine_id = $1 and v.year = 2017",
      [wineId],
    );
    expect(rows).toEqual([{ purchased_from: "Wijnhandel Vos" }]);
  });
});

test.describe("it all stays in the household", () => {
  test("another household can neither read the profile nor change a bottle's extras", async ({
    page,
    browser,
    request,
  }) => {
    const { email } = await arrive(page, "insiso");
    const { vintageId, bottleIds, token } = await furnish(request, email, marker());
    await api(request, token, "put", `/bottles/${bottleIds[0]}/extras`, {
      acquiredHow: "gift",
      giftFrom: "Oma",
      occasionTitle: null,
      occasionOn: null,
    });

    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "insisoother");
    const otherToken = await sessionToken(other.email);
    expect((await api(request, otherToken, "get", `/cellar/${vintageId}/insight`)).status()).toBe(
      404,
    );
    expect((await api(request, otherToken, "post", `/cellar/${vintageId}/insight`)).status()).toBe(
      404,
    );
    expect((await api(request, otherToken, "get", `/cellar/${vintageId}/extras`)).status()).toBe(
      404,
    );
    const stolen = await api(request, otherToken, "put", `/bottles/${bottleIds[0]}/extras`, {
      acquiredHow: "bought",
      giftFrom: null,
      occasionTitle: null,
      occasionOn: null,
    });
    expect(stolen.ok()).toBe(false);
    await context.close();

    const [row] = await sql<{ acquired_how: string; gift_from: string }>(
      "select acquired_how, gift_from from public.bottle_extras where bottle_id = $1",
      [bottleIds[0]],
    );
    expect(row).toEqual({ acquired_how: "gift", gift_from: "Oma" });
  });

  test("the API wants a real shape", async ({ page, request }) => {
    const { email } = await arrive(page, "insshape");
    const { vintageId, bottleIds, token } = await furnish(request, email, marker());
    const put = (data: unknown) =>
      api(request, token, "put", `/bottles/${bottleIds[0]}/extras`, data);
    expect(
      (
        await put({ acquiredHow: "stolen", giftFrom: null, occasionTitle: null, occasionOn: null })
      ).status(),
    ).toBe(422);
    expect(
      (
        await put({
          acquiredHow: null,
          giftFrom: null,
          occasionTitle: null,
          occasionOn: "2026-12-25",
        })
      ).status(),
    ).toBe(422);
    expect(
      (
        await api(request, token, "put", `/cellar/${vintageId}/insight`, { myValueCents: -1 })
      ).status(),
    ).toBe(422);
    expect(
      (
        await api(request, token, "put", `/cellar/${vintageId}/insight`, { myValueCents: 1234 })
      ).status(),
    ).toBe(200);
    expect((await api(request, token, "get", "/reminders")).status()).toBe(200);
  });
});
