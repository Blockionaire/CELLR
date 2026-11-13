import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { api, apiClient, arrive, audit, bearer, FEATURES_URL, sql, STACK, stamp } from "./helpers";

/**
 * Wine Intelligence WI-05: "Bronnen & betrouwbaarheid" on a wine page and in a Koopcheck result (the
 * `sources_panel` feature, second test server). It says where each kind of information really comes from, credits an
 * external source only where its record was verifiably linked and the source is cleared and shown to people, and
 * never gives a household's own wine a source it did not come from.
 */
test.use({ baseURL: FEATURES_URL });

const marker = () => `${test.info().parallelIndex}${stamp()}`;
const shot = (name: string) => `test-results/shots/${name}-${test.info().project.name}.png`;

/** A curated catalogue wine with the page its check rests on. */
async function seedCatalogueWine(m: string) {
  const producer = `Domaine Bronnen ${m}`;
  const name = `Cuvée Herkomst ${m}`;
  await sql("select public.catalog_import($1::jsonb, true)", [
    JSON.stringify([
      {
        producer,
        producer_country: "FR",
        name,
        type: "red",
        region: "Bordeaux",
        appellation: "Pauillac",
        vintages: [2019],
        sources: [{ name: "Producer website", url: `https://bronnen-${m}.example/cuvee` }],
      },
    ]),
  ]);
  const [wine] = await sql<{ id: string }>(
    `select w.id from public.wines w join public.producers p on p.id = w.producer_id
      where p.name = $1 and w.status = 'canonical'`,
    [producer],
  );
  return { producer, name, wineId: wine!.id };
}

/** A fictitious source (CELLR's own test data) with one record naming exactly that catalogue wine. */
async function seedSource(
  m: string,
  tag: string,
  wine: { producer: string; name: string; wineId: string },
  options: { scope: "public" | "off"; verifyLink: boolean; modified?: boolean },
) {
  const provider = `e2e${tag}_${m}`.toLowerCase().slice(0, 30);
  const providerName = `Testbron ${tag.toUpperCase()} ${m}`;
  await sql("select public.catalog_provider_register($1::jsonb)", [
    JSON.stringify({ id: provider, name: providerName }),
  ]);
  // Rights verified either way (these are CELLR's own fictitious records); "off" = cleared but not shown to people.
  // (The pilot scope cannot exist here: this database is not marked pilot, exactly like production. Its case is
  // covered by supabase/tests/99_wi05_wine_source_notices.test.sql.)
  await sql("select public.admin_catalog_provider_rights($1, $2::jsonb, $3, $4)", [
    provider,
    JSON.stringify({
      license: "CC BY 4.0",
      license_url: "https://creativecommons.org/licenses/by/4.0/",
      attribution: `${providerName} dataset (CELLR test fixture, not real data)`,
      modification_notice: "CELLR normalised the names and removed ratings.",
      commercial_use: true,
      rights_status: "verified",
      rights_evidence: "Fictitious records written by CELLR for its own end-to-end tests",
      rights_verified_at: "2026-11-13",
      rights_verified_by: "e2e",
      may_store: true,
      may_display: true,
      search_scope: options.scope,
    }),
    "CELLR's own test data",
    "e2e",
  ]);
  const [run] = await sql<{ id: string }>(
    "select public.catalog_import_run_start($1, 'e2e-1', null, null, null, now()) as id",
    [provider],
  );
  const externalId = `${tag.toUpperCase()}${m}`;
  await sql("select public.catalog_external_import($1, $2, $3::jsonb, true)", [
    provider,
    run!.id,
    JSON.stringify([
      {
        external_id: externalId,
        producer: wine.producer,
        name: wine.name,
        wine_type: "red",
        country_code: "FR",
        source_url: `https://${provider.replace(/_/g, "-")}.example/${externalId}`,
        ...(options.modified ? { modifications: ["name_normalized", "ratings_removed"] } : {}),
      },
    ]),
  ]);
  await sql("select public.catalog_import_run_finish($1, false, '{}'::jsonb)", [run!.id]);
  if (options.verifyLink)
    await sql(
      `select public.admin_catalog_record_decide(
         (select id from public.catalog_external_records where provider_id = $1 and external_id = $2),
         $3, 'verified', 'e2e: the same wine', null)`,
      [provider, externalId, wine.wineId],
    );
  return { provider, providerName, externalId };
}

async function openSources(page: Page, title = "Sources & reliability") {
  const section = page.getByTestId("sources");
  await expect(section).toBeVisible();
  await section.getByText(title, { exact: true }).click();
  await expect(page.getByTestId("sources-identity")).toBeVisible();
  return section;
}

test.describe("sources and reliability", () => {
  test("a catalogue wine with a profile: catalogue check, AI estimate and own data, each named as what it is", async ({
    page,
    request,
  }) => {
    const m = marker();
    const wine = await seedCatalogueWine(m);
    const consulted = [`https://bronnen-${m}.example/cuvee-2019`];
    await fetch(`${STACK}/__test/openai`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        match: m,
        content: {
          summary: `Domaine Bronnen ${m}: a structured Pauillac.`,
          style: "Full-bodied red",
          grapes: ["Cabernet Sauvignon", "Merlot"],
          tasting: "Cassis and cedar.",
          serving_temp_min_c: 16,
          serving_temp_max_c: 18,
          decant_minutes: 45,
          abv_percent: 13.5,
          pairings: ["Roast lamb"],
          aging: "Keeps for a decade.",
          body: 4,
          tannin: 4,
          sweetness: 1,
          acidity: 3,
          flavors: [{ group: "black_fruit", notes: ["Cassis"] }],
          pairing_kinds: ["lamb"],
          drink_from_year: 2024,
          drink_until_year: 2040,
          country_code: "FR",
          region: "Bordeaux",
          appellation: "Pauillac",
          confidence: "high",
          evidence: "exact_wine",
          sources: [{ name: "Domaine Bronnen", url: consulted[0] }],
        },
        consulted,
      }),
    });
    const me = await arrive(page, "bron");
    const client = await apiClient(request, me.email);
    await client.call(
      "post",
      "/bottles",
      { wineId: wine.wineId, year: 2019, quantity: 2, locationId: null, priceCents: 3200 },
      201,
    );
    const [vintage] = await sql<{ id: string }>(
      "select id from public.wine_vintages where wine_id = $1 and year = 2019",
      [wine.wineId],
    );
    expect(
      (await api(request, client.token, "post", `/cellar/${vintage!.id}/insight`)).status(),
    ).toBe(200);

    await page.goto(`/cellar/${vintage!.id}`);
    const section = await openSources(page);
    // identification: CELLR's own catalogue check, with the page it rests on; no external source is named
    const identity = page.getByTestId("source-identity");
    await expect(identity).toHaveAttribute("data-origin", "cellr_catalog");
    await expect(identity).toContainText("CELLR catalogue (verified)");
    const checkPage = identity.getByRole("link", { name: "Producer website" });
    await expect(checkPage).toHaveAttribute("href", `https://bronnen-${m}.example/cuvee`);
    await expect(checkPage).toHaveAttribute("target", "_blank");
    await expect(checkPage).toHaveAttribute("rel", /noopener/);
    await expect(checkPage).toHaveAttribute("rel", /noreferrer/);
    await expect(page.getByTestId("source-credit")).toHaveCount(0);
    await expect(page.getByTestId("sources-characteristics")).toContainText(
      "CELLR catalogue (verified)",
    );
    // the AI analysis: an estimate, dated, with the page it consulted; the window is an estimate too
    const ai = page.getByTestId("sources-ai");
    await expect(ai).toContainText("Estimates by CELLR, made with AI");
    const profile = ai.locator('[data-kind="profile"]');
    await expect(profile).toContainText("Wine profile");
    await expect(profile.getByRole("link", { name: "Domaine Bronnen" })).toHaveAttribute(
      "href",
      consulted[0]!,
    );
    await expect(ai.locator('[data-kind="window_profile"]')).toContainText("an estimate");
    await expect(ai.locator('[data-kind="window_table"]')).toHaveCount(0);
    // what the household recorded itself
    const yours = page.getByTestId("sources-yours");
    await expect(yours).toContainText("2 bottles in the cellar");
    await expect(yours).toContainText("2 purchase prices");
    await expect(yours).toContainText("visible to your household only");
    // nothing of a source is loaded: no image, frame or script from outside the app
    expect(await section.locator("img, iframe, script").count()).toBe(0);
    expect(await audit(page)).toEqual([]);
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("wi05-sources-catalogue-en-light"), fullPage: true });
    await page
      .getByTestId("sources")
      .screenshot({ path: shot("wi05-sources-catalogue-en-light-section") });

    // Koopcheck's result says what the catalogue's facts rest on, behind one disclosure
    await page.goto("/sommelier/purchase-check");
    await page.getByRole("button", { name: "Search by name instead" }).click();
    await page
      .getByRole("combobox", { name: "Search for the wine in the shop" })
      .fill(`cuvee herkomst ${m}`);
    await page
      .getByTestId("wine-option")
      .filter({ has: page.getByText(wine.name, { exact: true }) })
      .click();
    await page.getByTestId("pc-confirm").getByLabel("Vintage", { exact: true }).fill("2019");
    await page.getByRole("button", { name: "Compare with my cellar" }).click();
    const pcSources = page.getByTestId("pc-sources");
    await expect(pcSources).toBeVisible();
    await pcSources.getByText("Source of the wine details").click();
    await expect(pcSources.getByRole("link", { name: "Producer website" })).toBeVisible();
    await expect(pcSources).toContainText("CELLR catalogue (verified)");
    expect(await audit(page)).toEqual([]);
  });

  test("a wine the household typed in itself: no source is made up", async ({ page, request }) => {
    const m = marker();
    const me = await arrive(page, "eigen");
    const client = await apiClient(request, me.email);
    const made = await client.call<{ id: string }>(
      "post",
      "/wines",
      { producer: `Eigen Huis ${m}`, name: `Huiswijn ${m}`, type: "red", countryCode: "IT" },
      201,
    );
    const added = await client.call<{ vintageId: string }>(
      "post",
      "/bottles",
      { wineId: made.body.id, year: 2021, quantity: 1, locationId: null, priceCents: null },
      201,
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/cellar/${added.body.vintageId}`);
    const section = await openSources(page);
    const identity = page.getByTestId("source-identity");
    await expect(identity).toHaveAttribute("data-origin", "user_provided");
    await expect(identity).toContainText("Entered by your household");
    await expect(identity).toContainText("no external source was used");
    await expect(identity.getByRole("link")).toHaveCount(0);
    await expect(page.getByTestId("source-credit")).toHaveCount(0);
    await expect(section).not.toContainText("verified)");
    await expect(page.getByTestId("sources-characteristics")).toContainText(
      "Entered by your household",
    );
    await expect(page.getByTestId("sources-yours")).toContainText("1 bottle in the cellar");
    expect(await audit(page)).toEqual([]);
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("wi05-sources-own-wine-en-dark"), fullPage: true });
    await page
      .getByTestId("sources")
      .screenshot({ path: shot("wi05-sources-own-wine-en-dark-section") });
  });

  test("two cleared sources are each credited with licence, changes and no endorsement; a source that is not shown to people, a mere suggestion and a switched-off source are not", async ({
    page,
    request,
  }) => {
    const m = marker();
    const wine = await seedCatalogueWine(m);
    const a = await seedSource(m, "a", wine, { scope: "public", verifyLink: true, modified: true });
    const b = await seedSource(m, "b", wine, { scope: "public", verifyLink: true });
    const suggested = await seedSource(m, "s", wine, { scope: "public", verifyLink: false });
    const hidden = await seedSource(m, "h", wine, { scope: "off", verifyLink: true });

    const me = await arrive(page, "multi");
    await sql(
      "update public.profiles set locale = 'nl' where id = (select id from auth.users where email = $1)",
      [me.email],
    );
    const client = await apiClient(request, me.email);
    const added = await client.call<{ vintageId: string }>(
      "post",
      "/bottles",
      { wineId: wine.wineId, year: 2019, quantity: 1, locationId: null, priceCents: null },
      201,
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`/cellar/${added.body.vintageId}`);
    const section = await openSources(page, "Bronnen & betrouwbaarheid");
    const credits = page.getByTestId("source-credit");
    await expect(credits).toHaveCount(2); // the two verified links of sources shown to people; not the suggestion, not the hidden source
    const creditA = page.locator(`[data-testid="source-credit"][data-provider="${a.provider}"]`);
    await expect(creditA).toContainText(`Ook opgenomen in ${a.providerName}`);
    await expect(creditA).toContainText(`Bron: ${a.providerName} dataset`);
    await expect(creditA).toContainText("licentie CC BY 4.0");
    await expect(creditA).toContainText("bewerkt door CELLR");
    const creditB = page.locator(`[data-testid="source-credit"][data-provider="${b.provider}"]`);
    await expect(creditB).not.toContainText("bewerkt door CELLR"); // B's record was not changed, so it is not said
    await expect(section).not.toContainText(hidden.providerName);
    await expect(section).not.toContainText(suggested.providerName);
    // the wine's facts stay the catalogue's: a source listing the wine is not their origin
    await expect(page.getByTestId("sources-characteristics")).toContainText(
      "CELLR-catalogus (gecontroleerd)",
    );
    await expect(page.getByTestId("sources-characteristics")).not.toContainText("Testbron");

    await creditA.getByText("Licentie en details").click();
    await expect(creditA.getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by/4.0/",
    );
    await expect(creditA.getByRole("link", { name: a.externalId })).toHaveAttribute(
      "href",
      new RegExp(`/${a.externalId}$`),
    );
    await expect(creditA.getByTestId("source-modified")).toContainText(
      "CELLR normalised the names and removed ratings.",
    );
    await expect(creditA).toContainText(
      `${a.providerName} is niet verbonden aan CELLR en onderschrijft CELLR niet.`,
    );
    await expect(creditA).toContainText("maakt de gegevens niet gecontroleerd");
    expect(await section.locator("img, iframe, script").count()).toBe(0);
    expect(await audit(page)).toEqual([]);
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("wi05-sources-two-sources-nl-dark"), fullPage: true });
    await page
      .getByTestId("sources")
      .screenshot({ path: shot("wi05-sources-two-sources-nl-dark-section") });

    // light, same page
    await page.emulateMedia({ colorScheme: "light" });
    await page.reload();
    await openSources(page, "Bronnen & betrouwbaarheid");
    expect(await audit(page)).toEqual([]);
    await page.getByTestId("sources").scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("wi05-sources-two-sources-nl-light"), fullPage: true });
    await page
      .getByTestId("sources")
      .screenshot({ path: shot("wi05-sources-two-sources-nl-light-section") });

    // source A loses its rights: its credit is gone from the wine page at the next look, B's stays
    await sql("select public.admin_catalog_provider_disable($1, $2, $3, true)", [
      a.provider,
      "e2e: licence withdrawn",
      "e2e",
    ]);
    const after = await client.call<{ external: Array<{ providerId: string }> }>(
      "get",
      `/wines/${wine.wineId}/sources`,
      undefined,
      200,
    );
    expect(after.body.external.map((n) => n.providerId)).toEqual([b.provider]);
    await page.reload();
    await openSources(page, "Bronnen & betrouwbaarheid");
    await expect(page.getByTestId("source-credit")).toHaveCount(1);
    await expect(page.getByTestId("sources")).not.toContainText(a.providerName);
  });

  test("the API: exactly a credit's fields, closed to other households and strangers, absent with the feature off", async ({
    page,
    request,
    browser,
  }) => {
    const m = marker();
    const wine = await seedCatalogueWine(m);
    await seedSource(m, "a", wine, { scope: "public", verifyLink: true, modified: true });
    const a = await arrive(page, "api-a");
    const clientA = await apiClient(request, a.email);
    const own = await clientA.call<{ id: string }>(
      "post",
      "/wines",
      { producer: `Geheim Huis ${m}`, name: `Privé ${m}`, type: "red" },
      201,
    );
    const other = await browser.newContext({
      ...(test.info().project.use as BrowserContextOptions),
      baseURL: FEATURES_URL,
    });
    const b = await arrive(await other.newPage(), "api-b");
    const clientB = await apiClient(request, b.email);

    type Body = {
      catalog: boolean;
      catalogSources: Array<Record<string, unknown>>;
      external: Array<Record<string, unknown>>;
    };
    const mine = await clientA.call<Body>("get", `/wines/${wine.wineId}/sources`, undefined, 200);
    expect(Object.keys(mine.body).sort()).toEqual(["catalog", "catalogSources", "external"]);
    expect(Object.keys(mine.body.catalogSources[0]!).sort()).toEqual([
      "name",
      "retrievedAt",
      "url",
    ]);
    expect(Object.keys(mine.body.external[0]!).sort()).toEqual(
      [
        "attribution",
        "datasetVersion",
        "externalId",
        "legalNotice",
        "license",
        "licenseUrl",
        "modificationNotice",
        "modifications",
        "modified",
        "providerId",
        "providerName",
        "retrievedAt",
        "scope",
        "sourceUrl",
      ].sort(),
    );
    const text = JSON.stringify(mine.body);
    expect(text).not.toContain("Fictitious records written by CELLR"); // the rights evidence stays internal
    expect(text).not.toContain(a.householdId);

    // a household's own wine: its own household gets "nothing to credit"; another household gets "no such wine"
    const ownSources = await clientA.call<Body>(
      "get",
      `/wines/${own.body.id}/sources`,
      undefined,
      200,
    );
    expect(ownSources.body).toEqual({ catalog: false, catalogSources: [], external: [] });
    await clientB.call("get", `/wines/${own.body.id}/sources`, undefined, 404);
    await clientB.call("get", `/wines/not-a-uuid/sources`, undefined, 404);
    expect((await request.get(`/api/v1/wines/${wine.wineId}/sources`)).status()).toBe(401);

    // with the feature off (the default server) the route does not exist, and the page has no such section
    const off = await request.get(`http://localhost:3100/api/v1/wines/${wine.wineId}/sources`, {
      headers: bearer(clientA.token),
    });
    expect(off.status()).toBe(404);
  });
});
