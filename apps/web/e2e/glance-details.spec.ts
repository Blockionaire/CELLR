import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiClient, arrive, audit, sql, STACK } from "./helpers";

/**
 * The Drinkvenster and Waarde nu tiles open screens of their own, like the Where tile: the window as a chart to
 * explore year by year, and the value with what it rests on. Everything shown comes from what the page already
 * has; the AI here is the local stack's fake model (programmed per test), never a real one.
 */
const marker = () =>
  `[${test.info().parallelIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}]`;

async function program(match: string, plan: { sequence: unknown[]; consulted?: string[] }) {
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
  grapes: ["Merlot"],
  tasting: "Plum and cedar.",
  serving_temp_min_c: 16,
  serving_temp_max_c: 18,
  decant_minutes: 30,
  abv_percent: 13.5,
  pairings: ["Lamb"],
  aging: "Should keep improving for another ten years.",
  body: 4,
  tannin: 4,
  sweetness: 1,
  acidity: 3,
  flavors: [{ group: "black_fruit", notes: ["Plum"] }],
  pairing_kinds: ["lamb"],
  drink_from_year: 2022,
  drink_until_year: 2040,
  country_code: "FR",
  region: "Bordeaux",
  appellation: "Pauillac",
  confidence: "medium",
  evidence: "producer",
  sources: [],
};
const offer = (name: string, url: string, price: number) => ({
  name,
  url,
  price,
  vintage: 2015,
  bottle_ml: 750,
  same_wine: true,
});
const VALUE = {
  low: 40,
  high: 60,
  basis: "Two Dutch shops, November 2026.",
  sources: [
    offer("Wijnhandel Test", "https://wijnhandel.example/glance-2015", 40),
    offer("Slijterij Test", "https://slijterij.example/glance-2015", 60),
  ],
};
const CONSULTED = [
  "https://wijnhandel.example/glance-2015",
  "https://slijterij.example/glance-2015",
];

/** A 2015 red at €30 a bottle, with its AI profile (window 2022–2040) and, if asked, a value looked up. */
async function furnish(
  page: Page,
  request: Parameters<typeof apiClient>[0],
  who: string,
  value: boolean,
) {
  const { email } = await arrive(page, who);
  const { call } = await apiClient(request, email);
  const m = marker();
  const wine = (
    await call<{ id: string }>(
      "post",
      "/wines",
      {
        producer: "Glance Estate",
        name: `Cuvée ${m}`,
        type: "red",
        countryCode: "FR",
        region: "Bordeaux",
      },
      201,
    )
  ).body;
  await call(
    "post",
    "/bottles",
    { wineId: wine.id, year: 2015, quantity: 1, locationId: null, priceCents: 3000 },
    201,
  );
  const [vintage] = await sql<{ id: string }>(
    "select id from public.wine_vintages where wine_id = $1",
    [wine.id],
  );
  await program(m, { sequence: value ? [PROFILE, VALUE] : [PROFILE], consulted: CONSULTED });
  await page.goto(`/cellar/${vintage!.id}`);
  await page.getByRole("button", { name: "Tell me about this wine" }).click();
  await expect(page.getByTestId("insight").getByText(PROFILE.summary)).toBeVisible();
  if (value) {
    await page.getByRole("button", { name: "Look up the value" }).click();
    await expect(page.getByTestId("worth")).toContainText(/50[.,]00/);
  }
  return { vintageId: vintage!.id };
}

/** Where on the chart (as a page x) a calendar year sits: the chart spans 2015–2055 for this wine. */
async function xOf(scrub: Locator, v: number) {
  const box = (await scrub.boundingBox())!;
  const [start, end, W, PAD] = [2015, 2055, 320, 12];
  const u = PAD + ((v - start) / (end - start)) * (W - 2 * PAD);
  return { x: box.x + (u / W) * box.width, y: box.y + box.height / 2 };
}

const THIS_YEAR = new Date().getUTCFullYear();

test.describe("the at-a-glance tiles open their own screens", () => {
  test("Drinkvenster: the window, today, and a chart to explore by tap, drag, long press, keys and buttons", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await furnish(page, request, "glancedrink", false);

    const tile = page.getByTestId("drink-trigger");
    await expect(tile).toContainText("2022–2040");
    await expect(tile).toHaveAccessibleName(/2022–2040.*Show the drinking window/);
    await tile.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Drinking window" })).toBeVisible();
    await expect(dialog.getByTestId("drink-detail-window")).toHaveText("2022–2040");
    await expect(dialog.getByTestId("drink-detail-basis")).toHaveText("AI estimate");
    await expect(dialog.getByText(/An estimate by the AI/)).toBeVisible();
    await expect(dialog.getByTestId("drink-detail-aging")).toContainText(PROFILE.aging);

    // starts on this year, with today's marker, and says what this year means
    const scrub = dialog.getByRole("slider", { name: "Choose a year on the chart" });
    await expect(scrub).toHaveAttribute("aria-valuenow", String(THIS_YEAR));
    await expect(scrub).toHaveAttribute("aria-valuemin", "2015");
    await expect(scrub).toHaveAttribute("aria-valuemax", "2054");
    await expect(dialog.getByTestId("today-mark")).toBeVisible();
    await expect(dialog.getByTestId("drink-year-meaning")).toContainText(`In ${THIS_YEAR} `);
    // vertical swipes stay with the page
    expect(await scrub.evaluate((e) => getComputedStyle(e).touchAction)).toBe("pan-y");

    // tap a year
    const young = await xOf(scrub, 2018.5);
    await page.mouse.click(young.x, young.y);
    await expect(scrub).toHaveAttribute("aria-valuenow", "2018");
    await expect(dialog.getByTestId("drink-year-value")).toContainText("2018");
    await expect(dialog.getByTestId("drink-year-meaning")).toHaveText(
      "In 2018 it is still young: its window only opens in 2022. It needs more time.",
    );
    await expect(dialog.getByTestId("drink-selected-label")).toHaveText("2018");
    await expect(dialog.getByTestId("today-mark")).toBeVisible();

    // long press: the point is picked up, with its year and phase
    await page.mouse.move(young.x, young.y);
    await page.mouse.down();
    await expect(dialog.getByTestId("drink-selected-label")).toHaveText("2018 · Not yet");
    // …and dragging sideways scrubs through the years, the text following
    for (const v of [2020.5, 2024.5, 2030.5, 2038.5, 2047.5]) {
      const p = await xOf(scrub, v);
      await page.mouse.move(p.x, p.y, { steps: 3 });
    }
    await expect(scrub).toHaveAttribute("aria-valuenow", "2047");
    await page.mouse.up();
    await expect(dialog.getByTestId("drink-selected-label")).toHaveText("2047");
    await expect(dialog.getByTestId("drink-year-meaning")).toHaveText(
      "In 2047 it is past its window (which runs to 2040), by the estimate. Bottles can surprise, but do not count on it.",
    );
    await page.screenshot({
      path: `test-results/shots/drink-detail-${test.info().project.name}.png`,
    });

    // keys and buttons choose a year too
    await scrub.focus();
    await page.keyboard.press("Home");
    await expect(scrub).toHaveAttribute("aria-valuenow", "2015");
    await page.keyboard.press("ArrowRight");
    await expect(scrub).toHaveAttribute("aria-valuenow", "2016");
    await expect(dialog.getByRole("button", { name: "Previous year" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Previous year" }).click();
    await expect(scrub).toHaveAttribute("aria-valuenow", "2015");
    await expect(dialog.getByRole("button", { name: "Previous year" })).toBeDisabled();
    for (let i = 0; i < 12; i++) await dialog.getByRole("button", { name: "Next year" }).click();
    await expect(scrub).toHaveAttribute("aria-valuenow", "2027");
    await expect(dialog.getByTestId("drink-year-meaning")).toContainText(
      "In 2027 it is at its best",
    );
    expect(await audit(page)).toEqual([]);

    // closing leaves the page as it was; opening again starts on this year
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("drink-chart")).toBeVisible();
    await expect(page.getByTestId("drink-chart").getByRole("slider")).toHaveCount(0);
    await tile.click();
    await expect(scrub).toHaveAttribute("aria-valuenow", String(THIS_YEAR));
  });

  test("Waarde nu: the value, marked as an estimate with its method, pages and date; what was paid kept apart", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await furnish(page, request, "glancevalue", true);

    const tile = page.getByTestId("worth-trigger");
    await expect(tile).toContainText(/50[.,]00/);
    await tile.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Worth today" })).toBeVisible();
    await expect(dialog.getByTestId("value-kind")).toHaveText("Estimate from prices found");
    await expect(dialog.getByTestId("sheet-worth")).toContainText(/50[.,]00/);
    await expect(
      dialog.getByText("Between €40.00 and €60.00 in shops and auctions."),
    ).toBeVisible();
    await expect(dialog.getByTestId("sheet-value-sources").getByRole("link")).toHaveCount(2);
    await expect(dialog.getByText(/Looked up /)).toBeVisible();
    await expect(dialog.getByTestId("value-method")).toContainText(
      "asking prices for this wine and vintage",
    );
    await expect(dialog.getByTestId("value-paid")).toContainText("€30.00 per bottle on average");
    await expect(dialog.getByTestId("value-paid")).toContainText("+67%");
    await expect(dialog.getByText("What a bottle's value depends on")).toBeVisible();
    // one value looked up: no chart over time is drawn (nothing made up)
    await expect(dialog.getByText("Over time")).toHaveCount(0);
    await page.screenshot({
      path: `test-results/shots/value-detail-${test.info().project.name}.png`,
    });
    expect(await audit(page)).toEqual([]);

    // to the page's own "Worth today", to change it
    await dialog.getByTestId("value-manage").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("value")).toBeInViewport();

    // your own value is said to be yours, not an estimate
    await page.getByRole("button", { name: "Enter my own value" }).click();
    await page.getByLabel(/What is one bottle worth now/).fill("70");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("worth")).toContainText(/70[.,]00/);
    await page.getByTestId("worth-trigger").click();
    await expect(dialog.getByTestId("value-kind")).toHaveText("Your own value");
    await expect(dialog.getByTestId("value-method")).toHaveText(
      "You entered this value yourself; it was not looked up.",
    );
    await expect(dialog.getByTestId("sheet-value-sources")).toHaveCount(0);
  });

  test("without a window or a value the tiles are not there, and the page works as before", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "glancenone");
    const { call } = await apiClient(request, email);
    const wine = (
      await call<{ id: string }>(
        "post",
        "/wines",
        {
          producer: "Glance NV",
          name: "Brut",
          type: "sparkling",
          countryCode: "FR",
          region: "Champagne",
        },
        201,
      )
    ).body;
    await call(
      "post",
      "/bottles",
      { wineId: wine.id, year: null, quantity: 1, locationId: null },
      201,
    );
    const [vintage] = await sql<{ id: string }>(
      "select id from public.wine_vintages where wine_id = $1",
      [wine.id],
    );
    await page.goto(`/cellar/${vintage!.id}`);
    await expect(page.getByTestId("at-a-glance")).toBeVisible();
    await expect(page.getByTestId("bottle-count")).toHaveText("1");
    await expect(page.getByTestId("drink-trigger")).toHaveCount(0);
    await expect(page.getByTestId("worth-trigger")).toHaveCount(0);
    await expect(page.getByTestId("drink-explain")).toContainText("non-vintage");
  });
});
