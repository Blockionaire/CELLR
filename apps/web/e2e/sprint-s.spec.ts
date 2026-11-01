import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { arrive, sql, STACK } from "./helpers";

/**
 * Sprint S: database-first recognition, on the phone. A NEW photo of a known catalogue wine is read on the phone
 * (real tesseract.js OCR in the browser), matched exactly to the catalogue, and proposed without the vision model;
 * a reserve bottling of the same name, or a phone without the OCR, goes to the model as before.
 */
test.skip(({ isMobile }) => !isMobile, "the phone");

/** A name OCR reads reliably and nobody else uses: capitalised consonant–vowel syllables, letters only. */
const word = () => {
  const c = "BDKLMNRTV";
  const v = "AEIOU";
  let w = "";
  for (let i = 0; i < 3; i++)
    w += c[Math.floor(Math.random() * c.length)]! + v[Math.floor(Math.random() * v.length)]!;
  return w[0] + w.slice(1).toLowerCase();
};

/** Each photo has a size nobody else uses: that is how the fake model knows which answer to give. */
const uniqueSize = () => {
  const worker = test.info().parallelIndex;
  return { width: 1100 + worker * 7 + (Date.now() % 50), height: 1500 + worker * 3 };
};

/** A photographed label: lettering on paper on a dark background (rendered, so no photo is kept in the repo). */
async function labelPhoto(size: { width: number; height: number }, lines: string[]) {
  const x = size.width / 2;
  const text = lines
    .map(
      (t, i) =>
        `<text x="${x}" y="${560 + i * 110}" font-family="DejaVu Sans, sans-serif" font-size="${i < 2 ? 70 : 56}" text-anchor="middle" fill="#2a1d14">${t}</text>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">
    <rect width="100%" height="100%" fill="#2e2620"/>
    <rect x="${x - 380}" y="420" width="760" height="${110 * lines.length + 160}" rx="12" fill="#f3ead8"/>
    ${text}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

async function program(size: { width: number; height: number }, content: unknown) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...size, content }),
  });
  expect(res.ok).toBe(true);
}

async function catalogueWine() {
  const producer = `Domaine ${word()}`;
  const name = `Cuvée ${word()}`;
  const [p] = await sql<{ id: string }>(
    `insert into public.producers (name, country_code, status, origin)
     values ($1, 'FR', 'canonical', 'verified') returning id`,
    [producer],
  );
  const [w] = await sql<{ id: string }>(
    `insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
     values ($1, $2, 'white', 'FR', 'Loire', 'canonical', 'verified') returning id`,
    [p!.id, name],
  );
  return { producer, name, wineId: w!.id };
}

/** Opens the scan screen and lets the on-device reader load (its files are fetched once per browser). */
async function openScan(page: Page) {
  await page.goto("/scan");
  await expect(page.locator("html")).toHaveAttribute("data-ocr", "ready", { timeout: 30_000 });
}

const takePhoto = async (page: Page, photo: Buffer) =>
  page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "IMG_0101.jpg", mimeType: "image/jpeg", buffer: photo });

const photoRow = async (householdId: string) =>
  (
    await sql<{
      text_result: string | null;
      text_wine_id: string | null;
      text_year: number | null;
      ocr_ms: number | null;
    }>(
      `select text_result, text_wine_id, text_year, ocr_ms from public.bottle_images
        where household_id = $1 order by created_at desc limit 1`,
      [householdId],
    )
  )[0];

const labelReads = async (householdId: string) =>
  (
    await sql<{ n: string }>(
      "select count(*) as n from public.ai_usage where household_id = $1 and task = 'label_extraction'",
      [householdId],
    )
  )[0]!.n;

test("a new photo of a known catalogue wine is recognised from its label text, without the vision model", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { producer, name, wineId } = await catalogueWine();
  const { householdId } = await arrive(page, "textfirst");
  await openScan(page);
  const size = uniqueSize();
  // the model is not programmed for this photo: if it were asked, the scan would not say "label text"
  const photo = await labelPhoto(size, [
    producer.toUpperCase(),
    name,
    "2019",
    "Pouilly-Fumé",
    "Produit de France",
  ]);
  await takePhoto(page, photo);

  await expect(page.getByRole("heading", { name: "We found it" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Recognised from the printed label text, without AI/)).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  expect(await labelReads(householdId)).toBe("0");
  const row = await photoRow(householdId);
  expect(row).toMatchObject({ text_result: "hit", text_wine_id: wineId, text_year: 2019 });
  expect(row!.ocr_ms).toBeGreaterThan(0);
  test.info().annotations.push({
    type: "ocr_ms (Chromium, iPhone 13 emulation)",
    description: String(row!.ocr_ms),
  });

  // the person still confirms; the bottle is the catalogue wine itself, not a private duplicate
  await page.getByRole("button", { name: "Yes, add bottles" }).click();
  await expect(page.getByLabel("Vintage")).toHaveValue("2019");
  await page.getByRole("button", { name: "Add 1 bottle" }).click();
  await expect(page.getByText(new RegExp(`1 bottle of ${producer} ${name} 2019`))).toBeVisible();
  expect(
    await sql("select 1 from public.wines where owner_household_id = $1", [householdId]),
  ).toHaveLength(0);
  expect(
    await sql(
      `select 1 from public.bottles b join public.wine_vintages v on v.id = b.vintage_id
        where b.household_id = $1 and v.wine_id = $2 and v.year = 2019`,
      [householdId, wineId],
    ),
  ).toHaveLength(1);

  // No model looked at the photo, so there is no label outline and no straightened label for the 3D bottle: the
  // wine's page shows the existing fallback, the drawn bottle with the whole photo as a print (the person can frame
  // the label there). A catalogue wine with published 2D artwork shows that instead.
  const [bottle] = await sql<{ vintage: string; texture: string | null }>(
    `select b.vintage_id as vintage, i.texture_path as texture
       from public.bottles b join public.bottle_images i on i.id = b.front_image_id
      where b.household_id = $1`,
    [householdId],
  );
  expect(bottle!.texture).toBeNull();
  await page.goto(`/cellar/${bottle!.vintage}`);
  await expect(page.getByTestId("bottle-portrait")).toHaveAttribute("data-label", "print");
  await page.screenshot({ path: "test-results/shots/sprint-s-text-match-portrait.png" });

  // The same photo again, now confirmed: the identical-photo cache answers. The phone read the text first anyway (it
  // cannot know before the server looked); that time is recorded apart.
  await openScan(page);
  await takePhoto(page, photo);
  await expect(page.getByText(/You confirmed this exact photo before/)).toBeVisible({
    timeout: 20_000,
  });
  const [again] = await sql<{ cache: string; text: string | null; ocr_ms: number | null }>(
    `select cache_result as cache, text_result as text, ocr_ms from public.bottle_images
      where household_id = $1 order by created_at desc limit 1`,
    [householdId],
  );
  expect(again).toMatchObject({ cache: "hit", text: null });
  expect(again!.ocr_ms).toBeGreaterThan(0);
  test.info().annotations.push({
    type: "ocr_ms before a photo-cache hit",
    description: String(again!.ocr_ms),
  });
});

test("a reserve bottling of the same name is not guessed: the vision model reads it as before", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { producer, name } = await catalogueWine();
  const { householdId } = await arrive(page, "textreserve");
  await openScan(page);
  const size = uniqueSize();
  await program(size, {
    is_wine_label: true,
    producer,
    wine_name: `${name} Réserve`,
    vintage: 2018,
    non_vintage: false,
    wine_type: "white",
    country_code: "FR",
    region: "Loire",
    appellation: null,
    grapes: [],
    abv_percent: null,
    volume_ml: 750,
    text_seen: `${producer} ${name} Réserve 2018`,
    confidence: { producer: "high", wine_name: "high", vintage: "high" },
  });
  await takePhoto(page, await labelPhoto(size, [producer.toUpperCase(), name, "RÉSERVE", "2018"]));
  await expect(page.getByText(/Recognised from the printed label text/)).toHaveCount(0);
  await expect.poll(() => labelReads(householdId), { timeout: 20_000 }).toBe("1");
  expect((await photoRow(householdId))!.text_result).toBe("miss");
});

test("without the on-device reader the photo goes straight to the vision model", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { producer, name } = await catalogueWine();
  const { householdId } = await arrive(page, "textoff");
  await page.route("**/ocr/**", (route) => route.abort());
  await page.goto("/scan");
  const size = uniqueSize();
  await program(size, {
    is_wine_label: true,
    producer,
    wine_name: name,
    vintage: 2019,
    non_vintage: false,
    wine_type: "white",
    country_code: "FR",
    region: "Loire",
    appellation: null,
    grapes: [],
    abv_percent: null,
    volume_ml: 750,
    text_seen: `${producer} ${name} 2019`,
    confidence: { producer: "high", wine_name: "high", vintage: "high" },
  });
  await takePhoto(page, await labelPhoto(size, [producer.toUpperCase(), name, "2019"]));
  await expect(page.getByRole("heading", { name: "We found it" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Recognised from the printed label text/)).toHaveCount(0);
  expect(await labelReads(householdId)).toBe("1");
  expect((await photoRow(householdId))!.text_result).toBe("no_text");
});
