import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { api, apiClient, arrive, audit, sessionToken, STACK } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;
type Call = Awaited<ReturnType<typeof apiClient>>["call"];

const YEAR = new Date().getFullYear();
const WINES = [
  {
    producer: "Château Test",
    name: "Claret",
    type: "red",
    region: "Bordeaux",
    countryCode: "FR",
    year: YEAR - 6,
    cents: 3000,
  },
  {
    producer: "Domaine Test",
    name: "Chablis",
    type: "white",
    region: "Chablis",
    countryCode: "FR",
    year: YEAR - 2,
    cents: 2400,
  },
  {
    producer: "Maison Test",
    name: "Brut",
    type: "sparkling",
    region: "Champagne",
    countryCode: "FR",
    year: YEAR - 3,
    cents: 6500,
  },
  {
    producer: "Cantina Test",
    name: "Barolo",
    type: "red",
    region: "Barolo",
    countryCode: "IT",
    year: YEAR - 12,
    cents: 9000,
  },
];

async function furnish(call: Call) {
  const fridge = (
    await call("post", "/storage", { label: "Wine fridge", kind: "fridge", rows: 4, cols: 5 }, 201)
  ).body as { id: string };
  for (const w of WINES) {
    const wine = (
      await call(
        "post",
        "/wines",
        {
          producer: w.producer,
          name: w.name,
          type: w.type,
          countryCode: w.countryCode,
          region: w.region,
        },
        201,
      )
    ).body as { id: string };
    await call(
      "post",
      "/bottles",
      { wineId: wine.id, year: w.year, quantity: 2, locationId: fridge.id, priceCents: w.cents },
      201,
    );
  }
}

/** What the model is shown calls a wine by the first characters of its id. */
const refOf = (vintageId: string) => vintageId.replace(/-/g, "").slice(0, 6);

/** Words only this test's question contains: that is how the fake model knows which answer to give. */
const marker = () =>
  `[${test.info().parallelIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}]`;

async function program(match: string, plan: { content?: unknown; status?: number }) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ match, ...plan }),
  });
  expect(res.ok).toBe(true);
}
const modelCalls = async (match: string) =>
  (
    (await (
      await fetch(`${STACK}/__test/openai/calls?match=${encodeURIComponent(match)}`)
    ).json()) as { calls: Array<{ user: string; system: string }> }
  ).calls;

async function vintages(call: Call) {
  const cellar = (
    await call<{ items: Array<{ vintageId: string; wineName: string }> }>(
      "get",
      "/cellar",
      undefined,
      200,
    )
  ).body;
  return Object.fromEntries(cellar.items.map((i) => [i.wineName, i.vintageId])) as Record<
    string,
    string
  >;
}

const say = async (page: Page, text: string) => {
  await page.getByLabel("Your question").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
};

test.describe("what shall we drink tonight", () => {
  test("Home leads here; a tapped dish gets an honest pairing from the cellar", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "tonight");
    const { call } = await apiClient(request, email);
    await furnish(call);
    const ids = await vintages(call);
    // The fake model answers whatever question contains these words.
    await program("Steak tonight", {
      content: {
        answer: "The Barolo: firm tannins and enough fruit for a steak. It is at its best now.",
        bottle_refs: [refOf(ids["Barolo"]!)],
        verdict: "match",
        buy: [],
      },
    });

    await page.goto("/");
    await page.getByRole("link", { name: /What should we drink tonight/ }).click();
    await expect(page).toHaveURL(/\/tonight$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "What shall we drink tonight?",
    );
    await page.screenshot({ path: shot(`tonight-start-${project()}`), fullPage: true });
    await page.getByRole("button", { name: "Steak tonight" }).click();

    const log = page.getByRole("log", { name: "Conversation" });
    await expect(log.getByTestId("verdict")).toHaveText("A good match from your cellar");
    await expect(log.getByText(/The Barolo: firm tannins/)).toBeVisible();
    await expect(log.getByRole("link", { name: /Barolo/ })).toBeVisible();
    await expect(log.getByTestId("buy")).toHaveCount(0);
    const [asked] = await modelCalls("Steak tonight");
    expect(asked!.user).toContain("This is about tonight");
    expect(asked!.user).toContain("Budget for buying, per bottle: €15–30.");
    expect(asked!.system).toContain("judge honestly");
    await page.screenshot({ path: shot(`tonight-match-${project()}`), fullPage: true });
  });

  test("nothing fits: it says so, and suggests wines to buy within the chosen budget", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "tonightnone");
    const { call } = await apiClient(request, email);
    await furnish(call);
    const m = marker();
    await program(m, {
      content: {
        answer:
          "Honestly, nothing in your cellar suits sushi: the reds are too firm, the Chablis too young and oaky.",
        bottle_refs: [],
        verdict: "none",
        buy: [
          {
            wine: "Muscadet Sèvre et Maine, e.g. Domaine de la Pépière",
            why: "Saline and light.",
            price: "about €14",
          },
          { wine: "Grüner Veltliner, e.g. Hirsch", why: "Peppery and fresh.", price: "about €20" },
        ],
      },
    });
    await page.goto("/tonight");
    const budget = page.getByTestId("budget");
    await expect(budget.getByRole("radio", { name: "€15–30" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await budget.getByRole("radio", { name: "€30–60" }).click();
    await say(page, `Sushi ${m}`);

    const log = page.getByRole("log", { name: "Conversation" });
    await expect(log.getByTestId("verdict")).toHaveText("Nothing in your cellar really fits");
    await expect(log.getByRole("link")).toHaveCount(0); // no bottle forced on it
    const buy = log.getByTestId("buy");
    await expect(buy.getByRole("heading", { name: "Worth buying" })).toBeVisible();
    await expect(buy).toContainText("Muscadet Sèvre et Maine, e.g. Domaine de la Pépière");
    await expect(buy).toContainText("about €20");
    const [asked] = await modelCalls(m);
    expect(asked!.user).toContain("Budget for buying, per bottle: €30–60.");
    await page.screenshot({ path: shot(`tonight-none-${project()}`), fullPage: true });

    // The budget is remembered on this phone.
    await page.reload();
    await expect(page.getByTestId("budget").getByRole("radio", { name: "€30–60" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("an empty cellar can still ask what to buy for tonight", async ({ page }) => {
    await arrive(page, "tonightempty");
    const m = marker();
    await program(m, {
      content: {
        answer: "Your cellar is empty, so buy a bottle for the pizza.",
        bottle_refs: [],
        verdict: "none",
        buy: [
          {
            wine: "Barbera d'Asti, e.g. Braida",
            why: "Juicy, made for tomato.",
            price: "about €15",
          },
        ],
      },
    });
    await page.goto("/tonight");
    await expect(page.getByText(/Your cellar is still empty/)).toBeVisible();
    await say(page, `Pizza ${m}`);
    await expect(page.getByTestId("buy")).toContainText("Barbera d'Asti");
    const [asked] = await modelCalls(m);
    expect(asked!.user).toContain("Cellar: empty");
  });

  test("the API: valid requests, refused ones, and nobody else's cellar", async ({
    page,
    browser,
    request,
  }) => {
    const owner = await arrive(page, "tonightapi");
    const { call, token } = await apiClient(request, owner.email);
    await furnish(call);

    type Tonight = {
      picks: Array<{ slot: string; bottleId: string; reasons: string[] }>;
      considered: number;
    };
    const ok = (await call<Tonight>("post", "/tonight", { dish: "steak", occasion: "guests" }, 200))
      .body;
    expect(ok.considered).toBe(4);
    expect(ok.picks[0]?.slot).toBe("best");
    expect(ok.picks.every((p) => p.reasons.length <= 3)).toBe(true);
    // An empty request is "anything goes".
    expect((await call<Tonight>("post", "/tonight", {}, 200)).body.picks.length).toBeGreaterThan(0);
    // A dish that is not on the list, or an occasion that does not exist, is refused.
    expect((await call("post", "/tonight", { dish: "moon cheese" })).status).toBe(422);
    expect((await call("post", "/tonight", { occasion: "wedding" })).status).toBe(422);
    // Not signed in (a token that means nothing): no.
    expect(
      (
        await request.post("/api/v1/tonight", {
          data: {},
          headers: { authorization: "Bearer not-a-real-token" },
        })
      ).status(),
    ).toBe(401);

    // Someone else's cellar never shows up in your picks, nor yours in theirs.
    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const otherPage = await context.newPage();
    const other = await arrive(otherPage, "tonightoth");
    const theirs = await (
      await api(request, await sessionToken(other.email), "post", "/tonight", {})
    ).json();
    expect(theirs).toMatchObject({ considered: 0, picks: [] });
    expect(token).toBeTruthy();
    await context.close();
  });

  test("the chat is accessible in both themes", async ({ page, request }) => {
    const { email } = await arrive(page, "tonighta11y");
    const { call } = await apiClient(request, email);
    await furnish(call);
    const m = marker();
    await program(m, {
      content: {
        answer: "The Claret will do, though a lighter red would be better.",
        bottle_refs: [],
        verdict: "partial",
        buy: [{ wine: "Beaujolais, e.g. Morgon", why: "Lighter.", price: "about €18" }],
      },
    });
    await page.goto("/tonight");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
    }
    await say(page, `Roast chicken ${m}`);
    await expect(page.getByTestId("verdict")).toHaveText("Will do, but not ideal");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect.poll(() => audit(page)).toEqual([]);
      await page.screenshot({ path: shot(`tonight-${scheme}-${project()}`), fullPage: true });
    }
  });
});
