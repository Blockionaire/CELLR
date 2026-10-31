import { expect, test, type Page } from "@playwright/test";
import { arrive, makeJpeg, signIn, sql, STACK } from "./helpers";

/**
 * Sprint Q: a scan proposes a catalogue wine, the person corrects the vintage the scan read and saves. That is a scan
 * misread, not a fault in the catalogue record: it is captured as a scan signal for recognition quality, while the
 * catalogue wine itself counts as accepted and never lands in the admin's correction inbox. Nothing changes.
 */
test.skip(({ isMobile }) => !isMobile, "the phone");

const ADMIN_ID = "00000000-0000-4000-8000-00000000ad01";
const ADMIN_EMAIL = "feedback-admin@cellr.invalid";

/** Each photo has a size nobody else uses: that is how the fake model knows which answer to give. */
const uniqueSize = () => {
  const worker = test.info().parallelIndex;
  return { width: 733 + worker * 41 + (Date.now() % 89), height: 911 + worker * 13 };
};

async function program(size: { width: number; height: number }, content: unknown) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...size, content }),
  });
  expect(res.ok).toBe(true);
}

const takePhoto = async (page: Page, photo: Buffer) =>
  page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "IMG_0007.jpg", mimeType: "image/jpeg", buffer: photo });

test.afterEach(async () => {
  // The switch is shared by every test: leave it as it ships.
  await sql("update public.catalog_learning set mode = 'off'");
});

test("a corrected vintage is a scan misread, never evidence that the catalogue wine is wrong", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  const m = `${test.info().parallelIndex}${Date.now().toString(36)}`;
  const producer = `Château Témoin ${m}`;
  const name = `Grand Vin ${m}`;
  const [p] = await sql<{ id: string }>(
    `insert into public.producers (name, country_code, status, origin)
     values ($1, 'FR', 'canonical', 'verified') returning id`,
    [producer],
  );
  const [w] = await sql<{ id: string }>(
    `insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
     values ($1, $2, 'red', 'FR', 'Bordeaux', 'canonical', 'verified') returning id`,
    [p!.id, name],
  );
  const wineId = w!.id;
  // the owner has switched catalogue learning on (opt-out), as the admin page does
  await sql("update public.catalog_learning set mode = 'opt_out'");

  const { email } = await arrive(page, "correction");
  const size = uniqueSize();
  await program(size, {
    is_wine_label: true,
    producer,
    wine_name: name,
    vintage: 2016,
    non_vintage: false,
    wine_type: "red",
    country_code: "FR",
    region: "Bordeaux",
    appellation: null,
    grapes: [],
    abv_percent: null,
    volume_ml: 750,
    text_seen: `${producer} ${name} 2016`,
    confidence: { producer: "high", wine_name: "high", vintage: "high" },
  });

  // ---- the scan proposes the catalogue wine; the person corrects the vintage and saves ------------------------
  await page.goto("/scan");
  await takePhoto(page, await makeJpeg(page, { ...size, words: "Témoin" }));
  await expect(page.getByRole("heading", { name: "We found it" })).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Yes, add bottles" }).click();
  await expect(page.getByLabel("Vintage")).toHaveValue("2016");
  // typing on its own records nothing
  await page.getByLabel("Vintage").fill("2017");
  await page.getByLabel("Vintage").fill("2018");
  expect(
    await sql("select 1 from public.catalog_scan_signals where wine_id = $1", [wineId]),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Add 1 bottle" }).click();
  await expect(page.getByText(new RegExp(`1 bottle of ${producer} ${name} 2018`))).toBeVisible();

  // the catalogue record is accepted as it is; the misread vintage is kept as a bare scan signal
  await expect
    .poll(async () =>
      sql<{ signal: string; fields: string[] }>(
        "select signal, changed_fields as fields from public.catalog_scan_signals where wine_id = $1",
        [wineId],
      ),
    )
    .toEqual([{ signal: "accepted", fields: [] }]);
  expect(
    await sql<{ signal: string; fields: string[]; wine: string | null; confirmed: unknown }>(
      `select s.signal, s.changed_fields as fields, s.wine_id as wine, s.confirmed
         from public.catalog_scan_signals s join auth.users u on u.id = s.user_id
        where u.email = $1 and s.kind = 'ai'`,
      [email],
    ),
  ).toEqual([{ signal: "corrected", fields: ["year"], wine: null, confirmed: null }]);
  // the catalogue itself is untouched
  expect(await sql("select name, region from public.wines where id = $1", [wineId])).toEqual([
    { name, region: "Bordeaux" },
  ]);

  // ---- the admin: no catalogue correction to review; the misread shows under scan readings --------------------
  await sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
    ADMIN_ID,
    ADMIN_EMAIL,
  ]);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await context.newPage();
  await signIn(admin, ADMIN_EMAIL);
  await admin.goto("/admin/catalog");
  await admin.getByRole("link", { name: "Corrections from scans →" }).click();
  await expect(admin.getByRole("heading", { name: "Catalogue wines" })).toBeVisible();
  await expect(admin.getByRole("row").filter({ hasText: name })).toHaveCount(0);
  const scanReadings = admin.locator("section").filter({
    has: admin.getByRole("heading", { name: "Scan readings (last 30 days)" }),
  });
  await expect(scanReadings).toContainText(/Vintage \d+/);
  await expect(scanReadings).toContainText("never counts towards the corrections above");
  // the wine's own page lists nothing to review either
  await admin.goto(`/admin/catalog/corrections/${wineId}`);
  await expect(admin.getByRole("heading", { name: "Detail corrections" })).toBeVisible();
  await expect(admin.getByText(/accepted as is by 1 person/)).toBeVisible();
  await expect(admin.getByTestId("signal-review")).toHaveCount(0);
  await context.close();
});
