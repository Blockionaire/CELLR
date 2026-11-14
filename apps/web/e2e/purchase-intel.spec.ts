import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { api, apiClient, arrive, audit, bearer, FEATURES_URL, sql, STACK, stamp } from "./helpers";

/**
 * Wine Intelligence WI-04: Koopcheck reuses what CELLR already knows about the wine in the shop (the
 * `purchase_intel` feature, second test server): the catalogue's facts, a valid shared profile of exactly this
 * vintage, or only the wine's stable facts from another vintage. It never asks a model, never writes, and never
 * carries a drinking window across vintages.
 */
test.use({ baseURL: FEATURES_URL });

const marker = () => `${test.info().parallelIndex}${stamp()}`;

/** What the research model "answers" about the wine: a profile good enough to be shared. */
const profileOf = (m: string, url: string) => ({
  summary: `Intel Estate ${m}: a ripe, structured Bordeaux with plenty of life ahead.`,
  style: "Full-bodied red",
  grapes: ["Merlot", "Cabernet Franc"],
  tasting: "Plum, cedar and a little graphite.",
  serving_temp_min_c: 16,
  serving_temp_max_c: 18,
  decant_minutes: 45,
  abv_percent: 13.5,
  pairings: ["Roast lamb", "Hard cheese"],
  aging: "Should keep improving for another ten years.",
  body: 4,
  tannin: 4,
  sweetness: 1,
  acidity: 3,
  flavors: [{ group: "black_fruit", notes: ["Plum", "Blackcurrant"] }],
  pairing_kinds: ["lamb", "cheese"],
  drink_from_year: 2022,
  drink_until_year: 2040,
  country_code: "FR",
  region: "Bordeaux",
  appellation: "Pauillac",
  confidence: "high",
  evidence: "exact_wine",
  sources: [{ name: "Intel Estate", url }],
});

/** A curated catalogue wine (no grapes recorded) with a shared profile of its 2019, researched once by household A. */
async function seedKnownWine(
  m: string,
  request: Parameters<typeof apiClient>[0],
  newPage: () => Promise<Page>,
) {
  const producer = `Intel Estate ${m}`;
  const name = `Grand Cuvée ${m}`;
  await sql("select public.catalog_import($1::jsonb, true)", [
    JSON.stringify([
      {
        producer,
        producer_country: "FR",
        name,
        type: "red",
        region: "Bordeaux",
        appellation: "Pauillac",
        vintages: [2019, 2020],
        sources: [{ name: "Producer website", url: `https://intel-${m}.example/cuvee` }],
      },
    ]),
  ]);
  const [wine] = await sql<{ id: string }>(
    `select w.id from public.wines w join public.producers p on p.id = w.producer_id
      where p.name = $1 and w.status = 'canonical'`,
    [producer],
  );
  const [v2019] = await sql<{ id: string }>(
    "select id from public.wine_vintages where wine_id = $1 and year = 2019",
    [wine!.id],
  );
  const consulted = [`https://intel-${m}.example/cuvee-2019`];
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ match: m, content: profileOf(m, consulted[0]!), consulted }),
  });
  expect(res.ok).toBe(true);

  // Household A owns the 2019 and reads its profile: researched once, and shared.
  const a = await arrive(await newPage(), "intelA");
  const clientA = await apiClient(request, a.email);
  await clientA.call(
    "post",
    "/bottles",
    { wineId: wine!.id, year: 2019, quantity: 1, locationId: null, priceCents: 2750 },
    201,
  );
  const made = await api(request, clientA.token, "post", `/cellar/${v2019!.id}/insight`);
  expect(made.status()).toBe(200);
  expect(
    await sql("select 1 from public.shared_wine_profiles where vintage_id = $1", [v2019!.id]),
  ).toHaveLength(1);
  return { producer, name, wineId: wine!.id, v2019: v2019!.id, a };
}

const modelCalls = async (m: string) =>
  (
    (await (await fetch(`${STACK}/__test/openai/calls?match=${encodeURIComponent(m)}`)).json()) as {
      calls: unknown[];
    }
  ).calls.length;

async function footprint(householdId: string) {
  const [row] = await sql<Record<string, number>>(
    `select (select count(*)::int from public.bottles where household_id = $1) as bottles,
            (select count(*)::int from public.wines where owner_household_id = $1) as wines,
            (select count(*)::int from public.bottle_images where household_id = $1) as images,
            (select count(*)::int from public.vintage_insights where household_id = $1) as insights,
            (select count(*)::int from public.ai_usage where household_id = $1) as ai`,
    [householdId],
  );
  return row!;
}

type Compared = {
  wine: { grapes: string[]; appellation: string | null; year: number | null };
  verdict: string;
  knowledge?: {
    status: string;
    catalogWineId: string;
    added: Array<{ field: string; value: string; origin: string; level: string }>;
    profile: { year: number | null; drinkWindow: unknown; summary: string } | null;
  } | null;
};

test.describe("Koopcheck with what CELLR already knows", () => {
  test("a wine not in the cellar: this vintage's profile is reused, another vintage gets stable facts only", async ({
    page,
    request,
    browser,
  }) => {
    const m = marker();
    const known = await seedKnownWine(m, request, async () =>
      (
        await browser.newContext({
          ...(test.info().project.use as BrowserContextOptions),
          baseURL: FEATURES_URL,
        })
      ).newPage(),
    );
    const callsAfterA = await modelCalls(m);
    expect(callsAfterA).toBe(1);

    // Household B owns nothing of this wine. In the shop: search, choose, vintage 2019, compare.
    const b = await arrive(page, "intelB");
    const before = await footprint(b.householdId);
    await page.goto("/sommelier/purchase-check");
    await page.getByRole("button", { name: "Search by name instead" }).click();
    await page
      .getByRole("combobox", { name: "Search for the wine in the shop" })
      .fill(`grand cuvee ${m}`);
    await page
      .getByTestId("wine-option")
      .filter({ has: page.getByText(known.name, { exact: true }) })
      .click();
    const confirm = page.getByTestId("pc-confirm");
    await confirm.getByLabel("Vintage", { exact: true }).fill("2019");
    await confirm.getByRole("button", { name: "Compare with my cellar" }).click();

    const knowledge = page.getByTestId("pc-knowledge");
    await expect(knowledge).toHaveAttribute("data-status", "vintage_profile");
    await expect(page.getByTestId("pc-owned")).toHaveAttribute("data-kind", "none");
    const profile = page.getByTestId("pc-profile");
    await expect(profile).toContainText(`Intel Estate ${m}: a ripe, structured Bordeaux`);
    await expect(profile).toContainText("CELLR's AI estimate"); // an estimate, named as one, with its date
    await expect(profile).toContainText("Profile of 2019");
    await expect(page.getByTestId("pc-window")).toContainText("2022");
    await expect(page.getByTestId("pc-window")).toContainText("2040");
    // what the person left open, and where each came from
    const grapes = page.locator('[data-testid="pc-added"][data-field="grapes"]');
    await expect(grapes).toContainText("Merlot, Cabernet Franc");
    await expect(grapes).toHaveAttribute("data-origin", "ai_estimate");
    await expect(grapes).toContainText("for this vintage");
    const appellation = page.locator('[data-testid="pc-added"][data-field="appellation"]');
    await expect(appellation).toContainText("Pauillac");
    await expect(appellation).toHaveAttribute("data-origin", "cellr_catalog");
    expect(await audit(page)).toEqual([]);
    await page.screenshot({
      path: `test-results/shots/wi04-koopcheck-profile-${test.info().project.name}.png`,
      fullPage: true,
    });

    // The 2020: no profile of that year. The grapes come along as the wine's; the window does not.
    await page.getByRole("button", { name: "Correct the wine" }).click();
    await confirm.getByLabel("Vintage", { exact: true }).fill("2020");
    await confirm.getByRole("button", { name: "Compare with my cellar" }).click();
    await expect(knowledge).toHaveAttribute("data-status", "stable_facts");
    await expect(page.getByTestId("pc-profile")).toHaveCount(0);
    await expect(page.getByTestId("pc-window")).toHaveCount(0);
    await expect(grapes).toContainText("Merlot, Cabernet Franc");
    await expect(grapes).toContainText("from the profile of 2019");
    await expect(page.getByTestId("pc-knowledge-note")).toContainText("never carried over");
    await expect(page.getByTestId("pc-result")).not.toContainText("2040");
    expect(await audit(page)).toEqual([]);

    // No vintage given: the same stable facts, and it says why no vintage profile is shown.
    await page.getByRole("button", { name: "Correct the wine" }).click();
    await confirm.getByLabel("Vintage", { exact: true }).fill("");
    await confirm.getByRole("button", { name: "Compare with my cellar" }).click();
    await expect(knowledge).toHaveAttribute("data-status", "stable_facts");
    await expect(page.getByTestId("pc-knowledge-note")).toContainText("You gave no vintage");
    await expect(page.getByTestId("pc-window")).toHaveCount(0);

    // All of it: no model was asked, nothing was written, nothing was added to the cellar.
    expect(await modelCalls(m)).toBe(callsAfterA);
    expect(await footprint(b.householdId)).toEqual(before);
  });

  test("what the person typed is kept; a profile that no longer qualifies is not used; nothing of another household travels", async ({
    page,
    request,
    browser,
  }) => {
    const m = marker();
    const known = await seedKnownWine(m, request, async () =>
      (
        await browser.newContext({
          ...(test.info().project.use as BrowserContextOptions),
          baseURL: FEATURES_URL,
        })
      ).newPage(),
    );
    const b = await arrive(page, "intelC");
    const client = await apiClient(request, b.email);
    const wine = {
      producer: known.producer,
      name: known.name,
      year: 2019,
      nonVintage: false,
      type: "red",
      countryCode: "FR",
      region: null,
      appellation: null,
      grapes: ["Syrah"], // the person's own entry, right or wrong
    };
    const mine = await client.call<Compared>(
      "post",
      "/sommelier/purchase-check/compare",
      { wine, priceCents: 2450 },
      200,
    );
    expect(mine.body.wine.grapes).toEqual(["Syrah"]); // never replaced by what CELLR knows
    expect(mine.body.knowledge?.status).toBe("vintage_profile");
    expect(mine.body.knowledge?.added.map((f) => f.field).sort()).toEqual([
      "appellation",
      "region",
    ]);
    expect(mine.body.knowledge?.added.every((f) => f.origin === "cellr_catalog")).toBe(true);
    // public wine knowledge only: nothing of the household that had it researched, no price it paid
    const text = JSON.stringify(mine.body);
    expect(text).not.toContain(known.a.householdId);
    expect(text).not.toContain(known.a.email);
    expect(text).not.toMatch(/2750|27\.5/);

    // A wine that merely resembles the catalogue wine is not it: nothing is added, nothing is claimed.
    const lookalike = await client.call<Compared>(
      "post",
      "/sommelier/purchase-check/compare",
      { wine: { ...wine, name: `${known.name} Réserve`, grapes: [] }, priceCents: null },
      200,
    );
    expect(lookalike.body.knowledge ?? null).toBeNull();
    expect(lookalike.body.wine.grapes).toEqual([]);

    // The stored profile stops qualifying (here: its confidence is lowered): it is not reused, and nothing is made up.
    await sql(
      "update public.shared_wine_profiles set output = jsonb_set(output, '{confidence}', '\"low\"') where vintage_id = $1",
      [known.v2019],
    );
    const after = await client.call<Compared>(
      "post",
      "/sommelier/purchase-check/compare",
      { wine: { ...wine, grapes: [] }, priceCents: null },
      200,
    );
    expect(after.body.knowledge?.status).toBe("catalog_only");
    expect(after.body.knowledge?.profile).toBeNull();
    expect(after.body.wine.grapes).toEqual([]);
    expect(after.body.verdict).toBeTruthy(); // the comparison itself still answers

    // With the feature off (the default server) the answer is what it always was: no `knowledge` at all.
    const off = await request.post(
      "http://localhost:3100/api/v1/sommelier/purchase-check/compare",
      {
        headers: bearer(client.token),
        data: { wine: { ...wine, grapes: [] }, priceCents: null },
      },
    );
    expect(off.status()).toBe(200);
    const offBody = (await off.json()) as Compared;
    expect("knowledge" in offBody).toBe(false);
    expect(offBody.wine.appellation).toBeNull();
  });
});
