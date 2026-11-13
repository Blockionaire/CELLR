import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { apiClient, arrive, audit, FEATURES_URL, sql, stamp } from "./helpers";

/**
 * Wine Intelligence WI-02: the database-backed wine search in "add a bottle" and in Koopcheck, with the `wine_search`
 * feature switched on (the second test server). Everything a person can do with it, and every way it can fail.
 */
test.use({ baseURL: FEATURES_URL });

const marker = () => `${test.info().parallelIndex}${stamp()}`;
const SEARCH_LABEL = "Search your wines, or add a new one";

/** Two curated catalogue wines of one producer: a wine with a verified alias, and its reserve. */
async function seedCatalogue(m: string) {
  const producer = `Domaine Zoekveld ${m}`;
  const entries = [
    {
      producer,
      producer_country: "FR",
      name: `Cuvée Alpha ${m}`,
      type: "red",
      region: "Bourgogne",
      vintages: [2018],
      aliases: [`Alfa Bijnaam ${m}`],
      sources: [{ name: "Producer website", url: `https://zoek-${m}.example/alpha` }],
    },
    {
      producer,
      producer_country: "FR",
      name: `Cuvée Alpha Réserve ${m}`,
      type: "red",
      region: "Bourgogne",
      vintages: [2018],
      sources: [{ name: "Producer website", url: `https://zoek-${m}.example/reserve` }],
    },
  ];
  await sql("select public.catalog_import($1::jsonb, true)", [JSON.stringify(entries)]);
  const rows = await sql<{ id: string; name: string }>(
    `select w.id, w.name from public.wines w join public.producers p on p.id = w.producer_id
      where p.name = $1 and w.status = 'canonical' order by w.name`,
    [producer],
  );
  return { producer, alpha: rows[0]!, reserve: rows[1]! };
}

/**
 * A provider of CELLR's own fictitious records, with verified rights and shown to people, and one record. Its own
 * provider id per test, so switching it off in one test never touches another.
 */
async function seedProviderRecord(m: string) {
  const provider = `e2e_${m}`.toLowerCase().slice(0, 30);
  const producer = `Bodega Extern ${m}`;
  const name = `Tinto Fixture ${m}`;
  await sql("select public.catalog_provider_register($1::jsonb)", [
    JSON.stringify({ id: provider, name: `Testbron ${m}` }),
  ]);
  await sql("select public.admin_catalog_provider_rights($1, $2::jsonb, $3, $4)", [
    provider,
    JSON.stringify({
      license: "CC0-1.0",
      attribution: "CELLR test fixture (not real data)",
      may_store: true,
      may_display: true,
      commercial_use: true,
      rights_status: "verified",
      rights_evidence: "Fictitious records written by CELLR for its own end-to-end tests",
      rights_verified_at: "2026-11-13",
      rights_verified_by: "e2e",
      search_scope: "public",
    }),
    "CELLR's own test data",
    "e2e",
  ]);
  const [run] = await sql<{ id: string }>(
    "select public.catalog_import_run_start($1, 'e2e-1', null, null, null, now()) as id",
    [provider],
  );
  await sql("select public.catalog_external_import($1, $2, $3::jsonb, true)", [
    provider,
    run!.id,
    JSON.stringify([
      {
        external_id: `E${m}`,
        producer,
        name,
        wine_type: "red",
        country_code: "ES",
        region: "Rioja",
        vintages: [2019, 2020],
      },
    ]),
  ]);
  await sql("select public.catalog_import_run_finish($1, false, '{}'::jsonb)", [run!.id]);
  return { provider, providerName: `Testbron ${m}`, producer, name };
}

/** What a Koopcheck or a search must never change. */
async function counts(householdId: string) {
  const [row] = await sql<Record<string, number>>(
    `select (select count(*)::int from public.bottles where household_id = $1) as bottles,
            (select count(*)::int from public.wines where owner_household_id = $1) as wines,
            (select count(*)::int from public.bottle_images where household_id = $1) as images,
            (select count(*)::int from public.wine_vintages v join public.wines w on w.id = v.wine_id
              where w.owner_household_id = $1) as vintages`,
    [householdId],
  );
  return row!;
}

const combobox = (page: Page, name = SEARCH_LABEL) => page.getByRole("combobox", { name });
const options = (page: Page) => page.getByTestId("wine-option");
/** The results whose wine name is exactly this (a reserve is never counted as the wine it resembles). */
const named = (page: Page, name: string) =>
  options(page).filter({ has: page.getByText(name, { exact: true }) });

async function addOneBottle(page: Page, year: string) {
  await expect(page.getByRole("heading", { name: "How many, and where?" })).toBeVisible();
  await page.getByLabel("Vintage", { exact: true }).fill(year);
  await page.getByRole("button", { name: "Add 1 bottle" }).click();
  await expect(page.getByRole("heading", { name: "Added to your cellar." })).toBeVisible();
}

test.describe("wine search: adding a bottle", () => {
  test("an owned wine by keyboard, a catalogue wine with a new year, and a wine nobody knows", async ({
    page,
    request,
  }) => {
    const m = marker();
    const cat = await seedCatalogue(m);
    const { email, householdId } = await arrive(page, "zoek");
    const { call } = await apiClient(request, email);
    const own = await call<{ id: string }>(
      "post",
      "/wines",
      {
        producer: `Wijnhuis Eigen ${m}`,
        name: `Cuvée Thuis ${m}`,
        type: "white",
        countryCode: "FR",
      },
      201,
    );
    await call("post", "/bottles", { wineId: own.body.id, year: 2019, quantity: 2 }, 201);

    await page.goto("/cellar/add");
    const field = combobox(page);
    await expect(field).toBeFocused();
    // nothing typed: the own list, as before
    await expect(page.getByRole("heading", { name: "Recently added" })).toBeVisible();

    // ---- an owned wine, typed without accents, chosen with the keyboard ----
    await field.fill(`cuvee thuis ${m}`);
    const first = options(page).first();
    await expect(first).toHaveAttribute("data-source", "owned");
    await expect(first).toContainText(`Cuvée Thuis ${m}`);
    await expect(first).toContainText("In your cellar ×2");
    // (other tests' similar names may follow it: the search forgives typos, and this database is shared)
    await expect(page.getByTestId("wine-search-status")).toHaveText(/^\d+ wines? found$/);
    expect(await audit(page)).toEqual([]);
    await field.press("ArrowDown");
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(field).toHaveAttribute("aria-activedescendant", (await first.getAttribute("id"))!);
    await field.press("Escape");
    await expect(first).toHaveAttribute("aria-selected", "false");
    await expect(field).toHaveValue(`cuvee thuis ${m}`); // Escape lets go of the list, never of what was typed
    await field.press("ArrowDown");
    await field.press("Enter");
    await addOneBottle(page, "2020");
    expect(
      await sql("select count(*)::int as n from public.wines where owner_household_id = $1", [
        householdId,
      ]),
    ).toEqual([{ n: 1 }]); // the same wine: no duplicate was made
    expect((await counts(householdId)).bottles).toBe(3);

    // ---- a catalogue wine, found by its verified alias; a year the catalogue does not list yet ----
    await page.getByRole("button", { name: "Add another" }).click();
    await combobox(page).fill(`alfa bijnaam ${m}`);
    const alias = options(page).first();
    await expect(alias).toHaveAttribute("data-source", "catalog");
    await expect(alias).toContainText(`Cuvée Alpha ${m}`);
    await expect(alias).toContainText(`Also known as Alfa Bijnaam ${m}`);
    await expect(alias).toContainText("CELLR catalogue");
    await alias.click();
    await addOneBottle(page, "2015");
    expect(
      await sql(
        `select count(*)::int as n from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
          where b.household_id = $1 and v.wine_id = $2 and v.year = 2015`,
        [householdId, cat.alpha.id],
      ),
    ).toEqual([{ n: 1 }]); // the catalogue's own wine, with the new year
    expect((await counts(householdId)).wines).toBe(1); // and no private copy of it

    // ---- the reserve is its own result, never folded into the wine it resembles ----
    await page.getByRole("button", { name: "Add another" }).click();
    await combobox(page).fill(`zoekveld ${m}`);
    await expect(named(page, `Cuvée Alpha ${m}`)).toHaveCount(1);
    await expect(named(page, `Cuvée Alpha Réserve ${m}`)).toHaveCount(1);

    // ---- a wine nobody knows: what was typed is kept, and coming back keeps it too ----
    const unknown = `Onvindbaar ${m}`;
    await combobox(page).fill(unknown);
    await expect(page.getByTestId("wine-search-empty")).toContainText(unknown);
    await expect(page.getByTestId("wine-search-status")).toHaveText("No wines found");
    await page.getByRole("button", { name: `Add “${unknown}” as a new wine` }).click();
    await expect(page.getByRole("heading", { name: "A new wine" })).toBeVisible();
    await expect(page.getByLabel("Wine name")).toHaveValue(unknown);
    await page.getByRole("button", { name: "Back" }).click();
    await expect(combobox(page)).toHaveValue(unknown);
    await page.getByRole("button", { name: `Add “${unknown}” as a new wine` }).click();
    await page.getByLabel("Producer").fill(`Kelder Nieuw ${m}`);
    await page.getByRole("button", { name: "Continue" }).click();
    await addOneBottle(page, "2022");
    expect(
      await sql(
        "select status, owner_household_id as owner from public.wines where name = $1 order by created_at",
        [unknown],
      ),
    ).toEqual([{ status: "provisional", owner: householdId }]);
  });

  test("a record of an external source is confirmed by the person and becomes their own wine, never a catalogue wine", async ({
    page,
  }) => {
    const m = marker();
    const ext = await seedProviderRecord(m);
    const { householdId } = await arrive(page, "extern");
    const canonicalBefore = await sql(
      "select count(*)::int as n from public.wines where status = 'canonical'",
    );

    await page.goto("/cellar/add");
    await combobox(page).fill(`tinto fixture ${m}`);
    const record = options(page).first();
    await expect(record).toHaveAttribute("data-source", "provider");
    await expect(record).toContainText("External source, not verified");
    await expect(record).toContainText(ext.providerName);
    expect(await audit(page)).toEqual([]);
    await record.click();

    // not a wine yet: the form, with the source named and every field open to correction
    await expect(page.getByRole("heading", { name: "A new wine" })).toBeVisible();
    await expect(page.getByTestId("new-wine-notice")).toContainText(ext.providerName);
    await expect(page.getByTestId("new-wine-notice")).toContainText("has not verified");
    await expect(page.getByLabel("Producer")).toHaveValue(ext.producer);
    await expect(page.getByLabel("Wine name")).toHaveValue(ext.name);
    await expect(page.getByLabel("Region")).toHaveValue("Rioja");
    expect((await counts(householdId)).wines).toBe(0); // choosing a result created nothing
    await page.getByLabel("Wine name").fill(`${ext.name} Gecorrigeerd`);
    await page.getByRole("button", { name: "Continue" }).click();
    await addOneBottle(page, "2021");

    expect(
      await sql(
        "select name, status, origin, owner_household_id as owner from public.wines where owner_household_id = $1",
        [householdId],
      ),
    ).toEqual([
      {
        name: `${ext.name} Gecorrigeerd`,
        status: "provisional",
        origin: "user_entered",
        owner: householdId,
      },
    ]);
    // the catalogue is untouched, and nothing links the record to anything
    expect(
      await sql("select count(*)::int as n from public.wines where status = 'canonical'"),
    ).toEqual(canonicalBefore);
    expect(
      await sql(
        `select count(*)::int as n from public.catalog_record_links l
           join public.catalog_external_records e on e.id = l.record_id where e.provider_id = $1`,
        [ext.provider],
      ),
    ).toEqual([{ n: 0 }]);

    // the source is switched off while the screen is open: the next search no longer offers its record
    await sql("select public.admin_catalog_provider_disable($1, $2, $3, true)", [
      ext.provider,
      "rights withdrawn (e2e)",
      "e2e",
    ]);
    await page.getByRole("button", { name: "Add another" }).click();
    await combobox(page).fill(`bodega extern ${m}`);
    await expect(page.getByTestId("wine-search")).toHaveAttribute("data-status", "ready");
    await expect(options(page).filter({ hasText: ext.providerName })).toHaveCount(0);
    await expect(named(page, ext.name)).toHaveCount(0);
  });

  test("a source switched off while its record is on screen: the record cannot be used, and the same search no longer shows it", async ({
    page,
  }) => {
    const m = marker();
    const ext = await seedProviderRecord(m);
    const { householdId } = await arrive(page, "stale");
    const before = await counts(householdId);
    await page.goto("/cellar/add");
    const query = `tinto fixture ${m}`;
    let requests = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/catalog/search")) requests++;
    });
    await combobox(page).fill(query);
    const row = options(page).filter({ hasText: ext.providerName });
    await expect(row).toHaveCount(1);

    // the source loses its rights while its record is still on this screen
    await sql("select public.admin_catalog_provider_disable($1, $2, $3, true)", [
      ext.provider,
      "rights withdrawn (e2e)",
      "e2e",
    ]);
    // choosing it asks the server first: it is gone, so it is not used, the list is refreshed and the screen says so
    await row.click();
    await expect(page.getByTestId("wine-search-withdrawn")).toBeVisible();
    await expect(options(page).filter({ hasText: ext.providerName })).toHaveCount(0);
    await expect(page.getByTestId("wine-search")).toBeVisible(); // the "new wine" form did not open
    await expect(combobox(page)).toHaveValue(query);

    // the very same search again, well inside a minute: asked again, never served from the browser's memory
    const asked = requests;
    await combobox(page).fill("");
    await combobox(page).fill(query);
    await expect(page.getByTestId("wine-search")).toHaveAttribute("data-status", "ready");
    expect(requests).toBeGreaterThan(asked);
    await expect(options(page).filter({ hasText: ext.providerName })).toHaveCount(0);
    await expect(page.getByTestId("wine-search-withdrawn")).toHaveCount(0); // said once, until the person types
    expect(await counts(householdId)).toEqual(before); // nothing was created from the withdrawn record
  });
});

test.describe("wine search: when it cannot answer", () => {
  const SEARCH = "**/api/v1/catalog/search*";

  test("too many searches: one notice, the own list, the typed text kept, and no more requests", async ({
    page,
    request,
  }) => {
    const m = marker();
    const { email } = await arrive(page, "limiet");
    const { call } = await apiClient(request, email);
    await call(
      "post",
      "/wines",
      { producer: `Wijnhuis Limiet ${m}`, name: `Cuvée Lokaal ${m}`, type: "red" },
      201,
    );
    let asked = 0;
    await page.route(SEARCH, (route) => {
      asked++;
      return route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "RATE_LIMITED", message: "Too many requests.", retryable: true },
        }),
      });
    });
    await page.goto("/cellar/add");
    await combobox(page).fill(`cuvee lokaal ${m}`);
    const notice = page.getByTestId("wine-search-notice");
    await expect(notice).toHaveAttribute("data-reason", "limited");
    await expect(notice.getByRole("button")).toHaveCount(0); // nothing to hammer
    await expect(options(page).first()).toContainText(`Cuvée Lokaal ${m}`); // found in the own list instead
    await combobox(page).pressSequentially(" extra woorden", { delay: 30 });
    await page.waitForTimeout(700);
    expect(asked).toBe(1);
    await expect(combobox(page)).toHaveValue(`cuvee lokaal ${m} extra woorden`);
    await expect(page.getByRole("button", { name: /as a new wine/ })).toBeVisible();
  });

  test("offline, then back: nothing typed is lost and trying again works", async ({ page }) => {
    const m = marker();
    const cat = await seedCatalogue(m);
    await arrive(page, "offline");
    let fail = true;
    await page.route(SEARCH, (route) => (fail ? route.abort("failed") : route.continue()));
    await page.goto("/cellar/add");
    await combobox(page).fill(`zoekveld ${m}`);
    const notice = page.getByTestId("wine-search-notice");
    await expect(notice).toHaveAttribute("data-reason", "offline");
    await expect(combobox(page)).toHaveValue(`zoekveld ${m}`);
    fail = false;
    await notice.getByRole("button", { name: "Try again" }).click();
    await expect(options(page).filter({ hasText: cat.alpha.name })).toHaveCount(1);
    await expect(notice).toHaveCount(0);
  });

  test("a deployment without the search: the screen works from the own list, as before", async ({
    page,
    request,
  }) => {
    const m = marker();
    const { email } = await arrive(page, "zonder");
    const { call } = await apiClient(request, email);
    await call(
      "post",
      "/wines",
      { producer: `Wijnhuis Zonder ${m}`, name: `Cuvée Oud ${m}`, type: "red" },
      201,
    );
    let asked = 0;
    await page.route(SEARCH, (route) => {
      asked++;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ query: "x", results: [], available: false }),
      });
    });
    await page.goto("/cellar/add");
    await combobox(page).fill(`cuvee oud ${m}`);
    await expect(page.getByTestId("wine-search-notice")).toHaveAttribute(
      "data-reason",
      "unavailable",
    );
    await options(page)
      .filter({ hasText: `Cuvée Oud ${m}` })
      .click();
    await addOneBottle(page, "2020");
    expect(asked).toBe(1);
  });

  test("a slow answer to an earlier query never replaces the results of what is typed now", async ({
    page,
  }) => {
    const m = marker();
    const cat = await seedCatalogue(m);
    await arrive(page, "traag");
    let first = true;
    await page.route(SEARCH, async (route) => {
      if (!first) return route.continue();
      first = false;
      // the first request answers late, with something that must never be shown
      await new Promise((r) => setTimeout(r, 1500));
      return route
        .fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            query: "x",
            available: true,
            results: [
              {
                kind: "wine",
                wineId: "00000000-0000-4000-8000-000000000001",
                recordId: null,
                producer: "VEROUDERD",
                name: "Antwoord op de vorige vraag",
                matchedAlias: null,
                type: "red",
                countryCode: null,
                region: null,
                source: "catalog",
                verified: true,
                match: "prefix",
                bottles: 0,
                provider: null,
                vintages: null,
              },
            ],
          }),
        })
        .catch(() => {}); // the app cancelled this request: nothing to answer any more
    });
    await page.goto("/cellar/add");
    await combobox(page).fill("zoekv");
    await page.waitForTimeout(400); // the first request is on its way
    await combobox(page).fill(`zoekveld ${m} reserve`);
    await expect(options(page).first()).toContainText(cat.reserve.name);
    await page.waitForTimeout(1600); // the slow answer has come and gone
    await expect(page.getByText("VEROUDERD")).toHaveCount(0);
    await expect(options(page).first()).toContainText(cat.reserve.name);
  });
});

test.describe("wine search: Koopcheck", () => {
  test("search, choose, vintage and price, a verdict, and nothing added to the cellar", async ({
    page,
    request,
  }) => {
    const m = marker();
    const cat = await seedCatalogue(m);
    const { email, householdId } = await arrive(page, "koop");
    const { call } = await apiClient(request, email);
    const own = await call<{ id: string }>(
      "post",
      "/wines",
      { producer: cat.producer, name: cat.alpha.name, type: "red", countryCode: "FR" },
      201,
    );
    expect(own.body.id).toBe(cat.alpha.id); // typed exactly: the catalogue wine, not a private copy
    await call("post", "/bottles", { wineId: cat.alpha.id, year: 2018, quantity: 2 }, 201);
    const before = await counts(householdId);

    await page.goto("/sommelier/purchase-check");
    await page.getByRole("button", { name: "Search by name instead" }).click();
    const search = page.getByTestId("pc-search");
    const field = combobox(page, "Search for the wine in the shop");
    await expect(field).toBeFocused();
    await field.fill(`alpha ${m}`);
    // the wine and its reserve, apart
    await expect(named(page, cat.alpha.name)).toHaveCount(1);
    await expect(named(page, cat.reserve.name)).toHaveCount(1);
    expect(await audit(page)).toEqual([]);
    await named(page, cat.alpha.name).click();

    const confirm = page.getByTestId("pc-confirm");
    await expect(page.getByTestId("pc-chosen")).toHaveAttribute("data-source", "owned");
    await expect(confirm.getByLabel("Producer", { exact: true })).toHaveValue(cat.producer);
    await expect(confirm.getByLabel("Wine name or cuvée")).toHaveValue(cat.alpha.name);
    // the vintage is the bottle in the shop's: never filled in, never "this year"
    await expect(confirm.getByLabel("Vintage", { exact: true })).toHaveValue("");

    // back to the search: what was typed is still there
    await confirm.getByRole("button", { name: "Search again" }).click();
    await expect(field).toHaveValue(`alpha ${m}`);
    await expect(named(page, cat.alpha.name)).toContainText("In your cellar ×2");
    await named(page, cat.alpha.name).click();

    await confirm.getByLabel("Vintage", { exact: true }).fill("2021");
    await confirm.getByLabel("Asking price per bottle (optional)").fill("24,50");
    await confirm.getByRole("button", { name: "Compare with my cellar" }).click();
    const result = page.getByTestId("pc-result");
    await expect(result).toBeVisible();
    await expect(page.getByTestId("pc-owned")).toHaveAttribute("data-kind", "other_vintages");
    await expect(page.getByTestId("pc-price")).toContainText("24.50");
    await expect(page.getByTestId("pc-verdict")).toHaveAttribute(
      "data-verdict",
      /consider|depends|skip/,
    );
    expect(await audit(page)).toEqual([]);

    // correcting keeps the choice; nothing was added anywhere
    await result.getByRole("button", { name: "Correct the wine" }).click();
    await expect(confirm.getByLabel("Vintage", { exact: true })).toHaveValue("2021");
    expect(await counts(householdId)).toEqual(before);
    expect(
      await sql(
        "select count(*)::int as n from public.ai_usage u join auth.users a on a.id = u.user_id where a.email = $1",
        [email],
      ),
    ).toEqual([{ n: 0 }]); // no model was asked for any of this
    await expect(search).toHaveCount(0);
  });

  test("typing without choosing a result still works, with what is not known said honestly", async ({
    page,
  }) => {
    const m = marker();
    const { householdId } = await arrive(page, "koophand");
    const before = await counts(householdId);
    await page.goto("/sommelier/purchase-check");
    await page.getByRole("button", { name: "Search by name instead" }).click();
    await combobox(page, "Search for the wine in the shop").fill(`Onbekend Huis ${m}`);
    await expect(page.getByTestId("wine-search-empty")).toBeVisible();
    await page.getByTestId("pc-type").click();
    const confirm = page.getByTestId("pc-confirm");
    await expect(confirm.getByLabel("Producer", { exact: true })).toHaveValue(`Onbekend Huis ${m}`);
    await expect(page.getByTestId("pc-chosen")).toHaveCount(0);
    await confirm.getByRole("button", { name: "Compare with my cellar" }).click();
    await expect(page.getByTestId("pc-result")).toBeVisible();
    await expect(page.getByTestId("pc-taste")).toHaveAttribute("data-fit", "insufficient");
    expect(await counts(householdId)).toEqual(before);
  });

  test("a record of an external source is said to be unverified, and compared on its facts only", async ({
    page,
  }) => {
    const m = marker();
    const ext = await seedProviderRecord(m);
    const { householdId } = await arrive(page, "koopext");
    const before = await counts(householdId);
    await page.goto("/sommelier/purchase-check");
    await page.getByRole("button", { name: "Search by name instead" }).click();
    await combobox(page, "Search for the wine in the shop").fill(`tinto fixture ${m}`);
    await options(page).first().click();
    await expect(page.getByTestId("pc-chosen")).toHaveAttribute("data-source", "provider");
    await expect(page.getByTestId("pc-chosen")).toContainText(ext.providerName);
    await expect(page.getByTestId("pc-chosen")).toContainText("has not verified");
    const confirm = page.getByTestId("pc-confirm");
    await expect(confirm.getByLabel("Producer", { exact: true })).toHaveValue(ext.producer);
    await expect(confirm.getByLabel("Vintage", { exact: true })).toHaveValue(""); // the source's years are not the bottle's
    await confirm.getByRole("button", { name: "Compare with my cellar" }).click();
    await expect(page.getByTestId("pc-result")).toBeVisible();
    expect(await counts(householdId)).toEqual(before);
  });
});

test.describe("wine search: language, theme and what the API gives away", () => {
  test("Dutch and dark: the same search, readable and labelled", async ({ page }) => {
    const m = marker();
    const cat = await seedCatalogue(m);
    const { email } = await arrive(page, "nl");
    await sql(
      "update public.profiles set locale = 'nl' where id = (select id from auth.users where email = $1)",
      [email],
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/cellar/add");
    const field = page.getByRole("combobox", { name: "Zoek in je wijnen, of voeg een nieuwe toe" });
    await field.fill(`zoekveld ${m}`);
    await expect(options(page).first()).toContainText("CELLR-catalogus");
    await expect(page.getByTestId("wine-search-status")).toHaveText(/^\d+ wijn(en)? gevonden$/);
    await expect(named(page, cat.reserve.name)).toHaveCount(1);
    expect(await audit(page)).toEqual([]);
    await page.screenshot({
      path: `test-results/shots/wi02-search-nl-dark-${test.info().project.name}.png`,
      fullPage: true,
    });
    // the theme is read when the page loads (as in the other specs): load it again in light, then look
    await page.emulateMedia({ colorScheme: "light" });
    await page.reload();
    await page
      .getByRole("combobox", { name: "Zoek in je wijnen, of voeg een nieuwe toe" })
      .fill(`zoekveld ${m}`);
    await expect(named(page, cat.reserve.name)).toHaveCount(1);
    expect(await audit(page)).toEqual([]);
    await page.screenshot({
      path: `test-results/shots/wi02-search-nl-light-${test.info().project.name}.png`,
      fullPage: true,
    });
  });

  test("the answer holds wine facts only, is bounded, private per household, and closed to strangers", async ({
    page,
    request,
    browser,
  }) => {
    const m = marker();
    await seedCatalogue(m);
    const a = await arrive(page, "api-a");
    const clientA = await apiClient(request, a.email);
    await clientA.call(
      "post",
      "/wines",
      { producer: `Geheim Huis ${m}`, name: `Cuvée Privé ${m}`, type: "red" },
      201,
    );
    const other = await browser.newContext({ baseURL: FEATURES_URL });
    const b = await arrive(await other.newPage(), "api-b");
    const clientB = await apiClient(request, b.email);

    type Body = {
      query: string | null;
      available: boolean;
      results: Array<Record<string, unknown>>;
    };
    const mine = await clientA.call<Body>(
      "get",
      `/catalog/search?q=${encodeURIComponent(`prive ${m}`)}`,
    );
    expect(mine.status).toBe(200);
    expect(mine.body.results[0]).toMatchObject({ name: `Cuvée Privé ${m}`, source: "household" });
    // whatever else is offered is the shared catalogue's, never another household's wine
    expect(mine.body.results.slice(1).every((r) => r.source === "catalog")).toBe(true);
    // exactly these keys: no household, person, email, price, note or score ever travels with a result
    expect(Object.keys(mine.body).sort()).toEqual(["available", "query", "results"]);
    expect(Object.keys(mine.body.results[0]!).sort()).toEqual(
      [
        "bottles",
        "countryCode",
        "kind",
        "match",
        "matchedAlias",
        "name",
        "producer",
        "provider",
        "recordId",
        "region",
        "source",
        "type",
        "verified",
        "vintages",
        "wineId",
      ].sort(),
    );
    expect(JSON.stringify(mine.body)).not.toContain(a.householdId);
    expect(JSON.stringify(mine.body)).not.toContain(a.email);

    // another household never finds it; the catalogue it does
    const theirs = await clientB.call<Body>(
      "get",
      `/catalog/search?q=${encodeURIComponent(`prive ${m}`)}`,
    );
    expect(theirs.body.results.map((r) => r.name)).not.toContain(`Cuvée Privé ${m}`);
    expect(theirs.body.results.every((r) => r.source === "catalog")).toBe(true);
    expect(JSON.stringify(theirs.body)).not.toContain("Geheim Huis");
    const shared = await clientB.call<Body>(
      "get",
      `/catalog/search?q=${encodeURIComponent(`zoekveld ${m}`)}`,
    );
    expect(shared.body.results.map((r) => r.name)).toEqual(
      expect.arrayContaining([`Cuvée Alpha ${m}`, `Cuvée Alpha Réserve ${m}`]),
    );
    expect(shared.body.results.every((r) => r.source === "catalog" && r.verified === true)).toBe(
      true,
    );

    // bounded, whatever is asked for; too short is not a search; a stranger gets nothing
    const wide = await clientA.call<Body>("get", "/catalog/search?q=cuvee&limit=20");
    expect(wide.body.results.length).toBeLessThanOrEqual(20);
    expect((await clientA.call("get", "/catalog/search?q=cuvee&limit=500")).status).toBe(422);
    expect((await clientA.call<Body>("get", "/catalog/search?q=a")).body).toEqual({
      query: null,
      results: [],
      available: true,
    });
    expect((await request.get("/api/v1/catalog/search?q=cuvee")).status()).toBe(401);
    await other.close();
  });

  test("how long it takes here (API and what the person sees), written down for the report", async ({
    page,
    request,
  }) => {
    const m = marker();
    const cat = await seedCatalogue(m);
    const { email } = await arrive(page, "tijd");
    const { call } = await apiClient(request, email);
    const queries = [
      "zoekveld",
      `zoekveld ${m}`,
      "cuvee alpha",
      `alfa bijnaam ${m}`,
      "chateau",
      `reserve ${m}`,
    ];
    const api: number[] = [];
    for (let i = 0; i < 48; i++) {
      const t0 = Date.now();
      const r = await call(
        "get",
        `/catalog/search?q=${encodeURIComponent(queries[i % queries.length]!)}`,
      );
      expect(r.status).toBe(200);
      api.push(Date.now() - t0);
    }
    await page.goto("/cellar/add");
    const seen: number[] = [];
    for (const q of [`zoekveld ${m}`, `alpha reserve ${m}`, `alfa bijnaam ${m}`]) {
      await combobox(page).fill("");
      const t0 = Date.now();
      await combobox(page).fill(q);
      await expect(options(page).first()).toContainText(cat.producer);
      seen.push(Date.now() - t0);
    }
    const pct = (xs: number[], p: number) =>
      [...xs].sort((x, y) => x - y)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]!;
    const report = {
      project: test.info().project.name,
      note: "local stack on one machine: Next.js + PostgREST + Postgres, Chromium (the phone project is an emulated iPhone 13, not a phone). Not a production or device measurement.",
      api_ms: { n: api.length, p50: pct(api, 50), p95: pct(api, 95), max: Math.max(...api) },
      typed_to_first_result_ms: { n: seen.length, values: seen, includes_debounce_ms: 250 },
    };
    // also on the run's own output: the results folder is emptied by the next run
    console.log(`WI02_LATENCY ${JSON.stringify(report)}`);
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync(
      `test-results/wi02-latency-${test.info().project.name}.json`,
      JSON.stringify(report, null, 2),
    );
    // generous bounds: this guards against a regression of an order of magnitude, not a benchmark
    expect(report.api_ms.p95).toBeLessThan(1500);
    expect(Math.max(...seen)).toBeLessThan(4000);
  });
});
