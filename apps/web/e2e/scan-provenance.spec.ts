import { expect, test, type Page } from "@playwright/test";
import {
  apiClient,
  arrive,
  audit,
  chooseFile,
  FEATURES_URL,
  makeJpeg,
  sql,
  stamp,
  STACK,
} from "./helpers";

/**
 * Unified Scan, PR 2: verified autofill. Each field of the review says where it comes from (the label, CELLR's
 * verified catalogue, the household's own wine, an external source, or nowhere), a missing vintage stays missing
 * (never taken from the vintages a wine has), and a label that contradicts the wine found is never added to that
 * wine by default. The readings are programmed (the local stack's fake model).
 */

const marker = () => `${test.info().parallelIndex}${stamp()}`;

const label = (over: Record<string, unknown> = {}) => ({
  is_wine_label: true,
  producer: "x",
  wine_name: "y",
  vintage: 2019,
  non_vintage: false,
  wine_type: "red",
  country_code: "FR",
  region: null,
  appellation: null,
  grapes: [],
  abv_percent: null,
  volume_ml: 750,
  text_seen: "",
  confidence: { producer: "high", wine_name: "high", vintage: "high" },
  ...over,
});

let counter = 0;
const uniqueSize = () => {
  counter += 1;
  const worker = test.info().parallelIndex;
  return {
    width: 452 + worker * 47 + counter * 3 + (Date.now() % 79),
    height: 590 + counter * 7 + worker * 19,
  };
};
async function scanLabel(page: Page, content: unknown) {
  const size = uniqueSize();
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...size, content }),
  });
  expect(res.ok).toBe(true);
  await page.goto("/scan");
  await expect(page.getByTestId("shutter")).toBeVisible();
  await chooseFile(page.locator('input[type="file"]').first(), {
    name: "IMG_0001.jpg",
    mimeType: "image/jpeg",
    buffer: await makeJpeg(page, size),
  });
  await expect(page.getByTestId("scan-review")).toBeVisible();
}

const source = (page: Page, kind: string) =>
  page.locator(`[data-testid="wine-source"][data-source="${kind}"]`);

/** A canonical catalogue wine (verified), with a region and one known vintage (2018). */
async function seedCatalogueWine(m: string) {
  const producer = `Domaine Herkomst ${m}`;
  const name = `Cuvée Etiket ${m}`;
  await sql("select public.catalog_import($1::jsonb, true)", [
    JSON.stringify([
      {
        producer,
        producer_country: "FR",
        name,
        type: "red",
        region: "Bourgogne",
        vintages: [2018],
        aliases: [],
        sources: [{ name: "Producer website", url: `https://herkomst-${m}.example/` }],
      },
    ]),
  ]);
  const [row] = await sql<{ id: string }>(
    `select w.id from public.wines w join public.producers p on p.id = w.producer_id
      where p.name = $1 and w.name = $2 and w.status = 'canonical'`,
    [producer, name],
  );
  return { producer, name, id: row!.id };
}

test.describe("a catalogue wine (the resolver's server)", () => {
  test.use({ baseURL: FEATURES_URL });

  test("an exact match with a vintage: the label's fields say so, the rest is CELLR's, verified", async ({
    page,
  }) => {
    const m = marker();
    const cat = await seedCatalogueWine(m);
    await arrive(page, "prov-cat");
    await scanLabel(page, label({ producer: cat.producer, wine_name: cat.name, vintage: 2019 }));
    await expect(page.getByRole("heading", { name: "We found it" })).toBeVisible();
    await expect(page.getByTestId("scan-candidate")).toHaveAttribute("data-wine", cat.id);
    await expect(source(page, "label")).toHaveAttribute(
      "data-fields",
      "producer name type countryCode",
    );
    await expect(source(page, "label")).toContainText(
      "From the label: producer, name, kind, country",
    );
    // the region was not on the label: CELLR's verified catalogue says it, and says so
    await expect(source(page, "catalog")).toHaveAttribute("data-fields", "region");
    await expect(source(page, "catalog")).toContainText("CELLR database (verified): region");
    await expect(page.getByTestId("wine-conflict")).toHaveCount(0);
    await expect(page.getByLabel("Vintage")).toHaveValue("2019");
    await expect(page.getByTestId("vintage-source")).toHaveAttribute("data-source", "label");
    expect(await audit(page)).toEqual([]);
    await page.screenshot({
      path: `test-results/shots/provenance-catalog-${test.info().project.name}.png`,
      fullPage: true,
    });
  });

  test("an exact match without a vintage: the vintage stays empty, never one the wine happens to have", async ({
    page,
  }) => {
    const m = marker();
    const cat = await seedCatalogueWine(m);
    const { householdId } = await arrive(page, "prov-novint");
    await scanLabel(
      page,
      label({
        producer: cat.producer,
        wine_name: cat.name,
        vintage: null,
        confidence: { producer: "high", wine_name: "high", vintage: "low" },
      }),
    );
    await expect(page.getByTestId("scan-candidate")).toHaveAttribute("data-wine", cat.id);
    // the catalogue knows 2018 of this wine: it is not offered as this bottle's year
    await expect(page.getByLabel("Vintage")).toHaveValue("");
    await expect(page.getByTestId("vintage-source")).toHaveAttribute("data-source", "unknown");
    await expect(page.getByTestId("vintage-source")).toHaveText(
      "Not read from the label: type it or choose NV",
    );
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByText("Enter a year between 1800 and 2100, or choose NV.")).toBeVisible();
    expect(
      await sql("select 1 from public.bottles where household_id = $1", [householdId]),
    ).toHaveLength(0);
    // typed by the person: the "where from" line goes, the bottle is added with that year
    await page.getByLabel("Vintage").fill("2020");
    await expect(page.getByTestId("vintage-source")).toHaveCount(0);
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByText(new RegExp(`1 bottle of ${cat.producer}.* 2020`))).toBeVisible();
  });
});

test.describe("the household's own wines", () => {
  test("missing details stay unknown, and are said to be", async ({ page, request }) => {
    const { email } = await arrive(page, "prov-missing");
    const { call } = await apiClient(request, email);
    const m = marker();
    await call(
      "post",
      "/wines",
      { producer: `Clos Leeg ${m}`, name: "Sans Pays", type: "white" },
      201,
    );
    await scanLabel(
      page,
      label({
        producer: `Clos Leeg ${m}`,
        wine_name: "Sans Pays",
        wine_type: null,
        country_code: null,
      }),
    );
    await expect(page.getByRole("heading", { name: "We found it" })).toBeVisible();
    await expect(source(page, "label")).toHaveAttribute("data-fields", "producer name");
    // the kind is the household's own record; country and region nobody knows
    await expect(source(page, "cellar")).toHaveAttribute("data-fields", "type");
    await expect(source(page, "cellar")).toContainText("Your own wine: kind");
    await expect(source(page, "unknown")).toHaveAttribute("data-fields", "countryCode region");
  });

  test("a label that contradicts the wine found is never added to it by default", async ({
    page,
    request,
  }) => {
    const { email, householdId } = await arrive(page, "prov-conflict");
    const { call } = await apiClient(request, email);
    const m = marker();
    const producer = `Château Conflit ${m}`;
    const created = await call<{ id: string }>(
      "post",
      "/wines",
      { producer, name: "Grand Vin", type: "red", countryCode: "FR" },
      201,
    );
    // the same name, read as a white: never chosen for the person
    await scanLabel(page, label({ producer, wine_name: "Grand Vin", wine_type: "white" }));
    await expect(page.getByTestId("scan-candidate")).toHaveAttribute("data-selected", "false");
    await expect(page.locator('[data-testid="scan-candidate"][data-selected="true"]')).toHaveCount(
      0,
    );

    // another cuvée of the same name ("… Blanc"): offered, never taken for the person
    await scanLabel(page, label({ producer, wine_name: "Grand Vin Blanc" }));
    await expect(page.getByTestId("scan-candidate")).toHaveAttribute("data-selected", "false");
    expect(await audit(page)).toEqual([]);
    await page.screenshot({
      path: `test-results/shots/provenance-conflict-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(page.getByTestId("scan-review-error")).toHaveText(
      "Choose which wine it is first, or add it as a new wine.",
    );
    // the person says it is this wine: then it is, and the wine itself is not changed by the label
    await page.getByRole("button", { name: /Grand Vin/ }).click();
    await expect(page.getByTestId("scan-candidate")).toHaveAttribute("data-selected", "true");
    // what the label says otherwise stays beside it, never applied
    await expect(page.locator('[data-testid="wine-conflict"][data-field="name"]')).toHaveText(
      "The label says “Grand Vin Blanc” for the name. Not this wine? Choose another one.",
    );
    await page.getByRole("button", { name: "Add 1 bottle" }).click();
    await expect(
      page.getByText(new RegExp(`1 bottle of ${producer} Grand Vin 2019`)),
    ).toBeVisible();
    const [wine] = await sql<{ wine_type: string }>(
      "select wine_type from public.wines where id = $1",
      [created.body.id],
    );
    expect(wine!.wine_type).toBe("red");
    const [bottles] = await sql<{ n: number }>(
      `select count(*)::int as n from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
        where b.household_id = $1 and v.wine_id = $2`,
      [householdId, created.body.id],
    );
    expect(bottles!.n).toBe(1);
  });

  test("a new wine: each field read off the label says so, until the person changes it", async ({
    page,
  }) => {
    await arrive(page, "prov-new");
    const m = marker();
    await scanLabel(
      page,
      label({
        producer: `Domaine Nieuw ${m}`,
        wine_name: "Première",
        country_code: "FR",
        region: null,
      }),
    );
    await expect(page.getByRole("heading", { name: "A new wine" })).toBeVisible();
    const tag = (field: string) =>
      page.locator(`[data-testid="field-source"][data-field="${field}"]`);
    await expect(tag("producer")).toHaveAttribute("data-source", "label");
    await expect(tag("name")).toHaveText("From the label");
    await expect(tag("countryCode")).toHaveAttribute("data-source", "label");
    await expect(tag("region")).toHaveText("Unknown");
    await expect(page.getByTestId("vintage-source")).toHaveText("From the label");
    await page.getByLabel("Wine name").fill("Deuxième");
    await expect(tag("name")).toHaveCount(0);
    await expect(tag("producer")).toHaveAttribute("data-source", "label");
    expect(await audit(page)).toEqual([]);
  });
});
