import { expect, test } from "@playwright/test";
import { apiClient, arrive, FEATURES_URL, sql, stamp } from "./helpers";

/**
 * Ratings (docs/sprints/ratings/DESIGN.md): the wine page and a record's catalogue page show the CELLR score from
 * real numbers (a fictitious public source's aggregates plus CELLR reviews), per vintage, with the real counts; a
 * tasting is published as a review only by explicit consent and never with its private note; the record page leads
 * into the cellar. Every source, record and rating here is fictitious, written by these tests.
 */
test.use({ baseURL: FEATURES_URL });

const shot = (name: string) => `test-results/wine-ratings/${name}.png`;

async function publicSourceWithRatings(m: string) {
  const provider = `e2e_rt_${m}`.toLowerCase().slice(0, 30);
  await sql("select public.catalog_provider_register($1::jsonb)", [
    JSON.stringify({ id: provider, name: `Fictieve Bron ${m}` }),
  ]);
  await sql("select public.admin_catalog_provider_rights($1, $2::jsonb, $3, $4)", [
    provider,
    JSON.stringify({
      license: "CC0-1.0",
      attribution: "CELLR test fixture (not real data)",
      may_store: true,
      may_display: true,
      commercial_use: true,
      may_display_ratings: true,
      rights_status: "verified",
      rights_evidence: "Fictitious records written by CELLR for its own end-to-end tests",
      rights_verified_at: "2026-11-25",
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
  const producer = `Domaine Note ${m}`;
  const name = `Cuvée Étoile ${m}`;
  await sql("select public.catalog_external_import($1, $2, $3::jsonb, true)", [
    provider,
    run!.id,
    JSON.stringify([
      {
        external_id: `R${m}`,
        producer,
        name,
        wine_type: "red",
        country_code: "FR",
        region: "Bourgogne",
        vintages: [2018, 2019, 2020],
      },
    ]),
  ]);
  await sql("select public.catalog_import_run_finish($1, false, '{}'::jsonb)", [run!.id]);
  // 2019: 120 ratings; NV: 8 ratings. Distribution in half stars (0.5 … 5.0).
  const dist19 = [0, 1, 0, 3, 0, 12, 18, 46, 22, 18];
  const sum = (d: number[]) => d.reduce((a, n, i) => a + n * (i + 1), 0);
  const count = (d: number[]) => d.reduce((a, n) => a + n, 0);
  const distNv = [0, 0, 0, 1, 0, 2, 3, 2, 0, 0];
  const units = [
    {
      external_id: `R${m}`,
      vintage: 2019,
      count: count(dist19),
      sum_half: sum(dist19),
      distribution: dist19,
      first: "2015-01-01",
      last: "2021-06-01",
    },
    {
      external_id: `R${m}`,
      vintage: null,
      count: count(distNv),
      sum_half: sum(distNv),
      distribution: distNv,
    },
  ];
  const [rr] = await sql<{ id: string }>(
    "select public.catalog_rating_run_start($1, 'e2e-r1', null, $2, now(), 'latest-per-rater-v1', 2, $3) as id",
    [provider, "e".repeat(64), count(dist19) + count(distNv)],
  );
  await sql("select public.catalog_rating_import($1, $2, $3::jsonb, true)", [
    provider,
    rr!.id,
    JSON.stringify(units),
  ]);
  await sql("select public.catalog_rating_run_finish($1, false)", [rr!.id]);
  const [rec] = await sql<{ id: string }>(
    "select id from public.catalog_external_records where provider_id = $1 and external_id = $2",
    [provider, `R${m}`],
  );
  return { provider, producer, name, recordId: rec!.id, externalCount: count(dist19) };
}

test.describe("ratings on the wine page and the catalogue page", () => {
  test("the CELLR score from real numbers, a review published by consent, the record page", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const m = `${test.info().parallelIndex}${stamp()}`;
    const src = await publicSourceWithRatings(m);
    const { email } = await arrive(page, "ratings-ui");
    const { call } = await apiClient(request, email);

    // the household's wine, made from the record (R-27), with a 2019 bottle opened and tasted (4.5 stars + a note)
    const wine = (
      await call(
        "post",
        "/wines",
        {
          producer: src.producer,
          name: src.name,
          type: "red",
          countryCode: "FR",
          region: "Bourgogne",
          sourceRecordId: src.recordId,
        },
        201,
      )
    ).body as { id: string };
    const added = (
      await call(
        "post",
        "/bottles",
        { wineId: wine.id, year: 2019, quantity: 1, locationId: null },
        201,
      )
    ).body as { bottleIds: string[]; vintageId?: string };
    const bottle = added.bottleIds[0]!;
    await call("patch", `/bottles/${bottle}`, { action: "open" }, 200);
    await call(
      "put",
      `/bottles/${bottle}/tasting`,
      { score: 9, descriptors: ["elegant"], note: "PRIVATE: bij schoonmoeder" },
      200,
    );
    const [v] = await sql<{ id: string }>(
      "select vintage_id as id from public.bottles where id = $1",
      [bottle],
    );

    await page.goto(`/cellar/${v!.id}`);
    const panel = page.getByTestId("ratings-panel");
    await expect(panel).toBeVisible();
    // 120 external ratings (weight 50) only, before anyone in CELLR reviewed it; the real count is shown
    await expect(panel.getByTestId("ratings-total")).toHaveText("Based on 120 ratings");
    const before = await panel.getByTestId("cellr-score").innerText();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("wine-page-before"), fullPage: false });

    // publish: consent is required, the private note is never shared
    await panel.getByRole("button", { name: "Share your review" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Publish" })).toBeDisabled();
    await dialog.getByLabel("Your review (optional)").fill("Fijne kers, lange afdronk.");
    await dialog.getByRole("checkbox").check();
    await page.screenshot({ path: shot("publish-sheet") });
    await dialog.getByRole("button", { name: "Publish" }).click();
    await expect(page.getByText("Your review is published.")).toBeVisible();
    await expect(panel.getByTestId("ratings-total")).toHaveText("Based on 121 ratings");
    await expect(panel.getByTestId("review")).toHaveCount(1);
    await expect(panel.getByTestId("review").first()).toContainText("Fijne kers, lange afdronk.");
    await expect(panel).not.toContainText("schoonmoeder");
    // the community average is shown apart, with its real count (120 external at ~4.0 and one at 4.5: the combined
    // score moves only a little, by weight 5 against 50)
    await expect(panel.getByText("CELLR community", { exact: true }).locator("..")).toContainText(
      "4.5",
    );
    await expect(panel.getByText("CELLR community", { exact: true }).locator("..")).toContainText(
      "1 rating",
    );
    expect(
      Number((await panel.getByTestId("cellr-score").innerText()).replace(",", ".")),
    ).toBeGreaterThanOrEqual(Number(before.replace(",", ".")));
    // editing loads the published text: publishing again never wipes it
    await panel.getByRole("button", { name: "Edit your review" }).click();
    await expect(page.getByRole("dialog").getByLabel("Your review (optional)")).toHaveValue(
      "Fijne kers, lange afdronk.",
    );
    await page.keyboard.press("Escape");
    await panel.getByTestId("reviews").scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("wine-page-after"), fullPage: false });

    // NV and "all vintages" are their own selections; a vintage nobody rated says so
    await panel.getByRole("button", { name: "NV", exact: true }).click();
    await expect(panel.getByTestId("ratings-total")).toHaveText("Based on 8 ratings");
    await panel.getByRole("button", { name: "All vintages" }).click();
    await expect(panel.getByTestId("ratings-total")).toHaveText("Based on 129 ratings");

    // the record's catalogue page: identity, the same ratings, and a way into the cellar
    await page.goto(`/catalog/${src.recordId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(src.name);
    await expect(page.getByTestId("ratings-panel")).toBeVisible();
    await page.screenshot({ path: shot("record-page"), fullPage: true });
    await page.getByTestId("add-from-record").click();
    await expect(page).toHaveURL(/\/cellar\/add\?record=/);
    // the record's ratings are right there in the add flow
    await expect(page.getByTestId("ratings-panel")).toBeVisible();
    await expect(page.getByLabel(/Who makes it|Producer/).first()).toHaveValue(src.producer);

    // the methodology page names the source and its citation
    await page.goto("/about/ratings");
    await expect(page.getByText(/X-Wines/).first()).toBeVisible();
    await page.screenshot({ path: shot("about"), fullPage: true });

    // switched off: the ratings are gone at once (nothing deleted)
    await sql("select public.admin_catalog_provider_disable($1, 'off (e2e)', 'e2e')", [
      src.provider,
    ]);
    await page.goto(`/cellar/${v!.id}`);
    await expect(page.getByRole("heading", { name: "Ratings" })).toHaveCount(0);
  });

  test("a wine with no catalogue identity has no ratings block, and nothing is made up", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "ratings-none");
    const { call } = await apiClient(request, email);
    const wine = (
      await call(
        "post",
        "/wines",
        {
          producer: `Huis ${stamp()}`,
          name: "Eigen Wijn",
          type: "red",
          countryCode: "FR",
        },
        201,
      )
    ).body as { id: string };
    const added = (
      await call(
        "post",
        "/bottles",
        { wineId: wine.id, year: 2020, quantity: 1, locationId: null },
        201,
      )
    ).body as { bottleIds: string[] };
    const [v] = await sql<{ id: string }>(
      "select vintage_id as id from public.bottles where id = $1",
      [added.bottleIds[0]],
    );
    await page.goto(`/cellar/${v!.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("ratings-panel")).toHaveCount(0);
    await expect(page.getByTestId("cellr-score")).toHaveCount(0);
  });
});
