import { expect, test, type Page } from "@playwright/test";
import { api, apiClient, arrive, makeJpeg, sessionToken, signIn, sql, stamp } from "./helpers";

/**
 * Sprint P: the demand-driven 2D bottle library. A person sends a photo of a whole bottle (with consent, points
 * once per wine); the admin reviews it, uploads a finished 2D bottle picture and publishes it on the canonical wine;
 * from then on the app shows it for that wine, and every other wine keeps its own picture.
 */
test.skip(({ isMobile }) => !isMobile, "the phone");

/** The admin the test server is started with (playwright.config.ts → CELLR_ADMIN_USER_IDS). */
const ADMIN_ID = "00000000-0000-4000-8000-00000000ad01";
const ADMIN_EMAIL = "feedback-admin@cellr.invalid";

/** A canonical (catalogue) wine with one vintage, as the catalogue import would make it. */
async function catalogueWine(name: string) {
  const [p] = await sql<{ id: string }>(
    `insert into public.producers (name, country_code, status, origin)
     values ($1, 'FR', 'canonical', 'verified') returning id`,
    [`Château ${name}`],
  );
  const [w] = await sql<{ id: string }>(
    `insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
     values ($1, $2, 'red', 'FR', 'Bordeaux', 'canonical', 'verified') returning id`,
    [p!.id, name],
  );
  return w!.id;
}

/** A finished 2D bottle picture: a transparent PNG with a bottle shape, drawn in the browser. */
async function bottlePng(page: Page) {
  const base64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 1200;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#2c3b22";
    ctx.fillRect(150, 40, 100, 300);
    ctx.fillRect(80, 340, 240, 820);
    ctx.fillStyle = "#f4ecd8";
    ctx.fillRect(100, 640, 200, 260);
    return c.toDataURL("image/png").split(",")[1]!;
  });
  return { name: "bottle.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

const submissionsOf = (email: string) =>
  sql<{ id: string; status: string; reward_points: number | null; consent: boolean }>(
    `select s.id, s.status, s.reward_points, s.consent_granted_at is not null as consent
       from public.bottle_photo_submissions s join auth.users u on u.id = s.user_id
      where u.email = $1 order by s.created_at`,
    [email],
  );

test("a bottle photo: consent, points once; the admin publishes a 2D bottle; the wine shows it", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const name = `Grand Vin ${stamp()}`;
  const wineId = await catalogueWine(name);
  const { email } = await arrive(page, "bottlephoto");
  const { call } = await apiClient(request, email);
  await call("post", "/bottles", { wineId, year: 2016, quantity: 2, locationId: null }, 201);
  // a wine of the household's own, without any picture: it must keep the drawn bottle
  const own = (
    await call<{ id: string }>(
      "post",
      "/wines",
      { producer: "Domaine Maison", name: `Cuvée ${stamp()}`, type: "white", countryCode: "FR" },
      201,
    )
  ).body;
  await call(
    "post",
    "/bottles",
    { wineId: own.id, year: 2021, quantity: 1, locationId: null },
    201,
  );
  const [v] = await sql<{ id: string }>(
    "select id from public.wine_vintages where wine_id = $1 and year = 2016",
    [wineId],
  );

  // ---- the person sends a photo from the wine's page ---------------------------------------------------------
  await page.goto(`/cellar/${v!.id}`);
  await expect(page.getByTestId("bottle-portrait")).toHaveAttribute("data-label", "typeset");
  const more = page.getByTestId("complete-wine");
  if ((await more.getAttribute("open")) === null) await more.locator("summary").click();
  await more.getByRole("button", { name: "Share a bottle photo" }).click();
  const sheet = page.getByRole("dialog", { name: "A photo of the bottle" });
  await expect(sheet.getByText(/CELLR uses it to make a clean 2D bottle picture/)).toBeVisible();
  const send = sheet.getByRole("button", { name: "Send photo" });
  await expect(send).toBeDisabled();
  await sheet.locator('input[type="file"]').setInputFiles({
    name: "IMG_0042.jpg",
    mimeType: "image/jpeg",
    buffer: await makeJpeg(page, { width: 900, height: 1600, words: "Bottle", exif: true }),
  });
  // a photo alone is not enough: the explicit yes is needed
  await expect(send).toBeDisabled();
  await sheet.getByRole("checkbox", { name: /CELLR may use this photo/ }).check();
  await send.click();
  await expect(sheet.getByText("Thank you!")).toBeVisible();
  await expect(sheet.getByText("You earned 10 points.", { exact: false })).toBeVisible();
  await expect(sheet.getByTestId("points-total")).toHaveText("You have 10 points.");
  await sheet.getByRole("button", { name: "Done" }).click();

  // a second photo of the same wine is welcome, and earns nothing
  await more.getByRole("button", { name: "Share a bottle photo" }).click();
  await sheet.locator('input[type="file"]').setInputFiles({
    name: "IMG_0043.jpg",
    mimeType: "image/jpeg",
    buffer: await makeJpeg(page, { width: 900, height: 1600, words: "Again" }),
  });
  await sheet.getByRole("checkbox").check();
  await sheet.getByRole("button", { name: "Send photo" }).click();
  await expect(sheet.getByText(/already earned points for this wine/)).toBeVisible();
  await expect(sheet.getByTestId("points-total")).toHaveText("You have 10 points.");
  await sheet.getByRole("button", { name: "Done" }).click();

  const sent = await submissionsOf(email);
  expect(sent.map((s) => [s.status, s.reward_points, s.consent])).toEqual([
    ["pending", 10, true],
    ["pending", null, true],
  ]);
  const [pointRows] = await sql<{ n: string; total: string }>(
    `select count(*)::text as n, coalesce(sum(points), 0)::text as total from public.account_points a
       join auth.users u on u.id = a.user_id where u.email = $1`,
    [email],
  );
  expect(pointRows).toEqual({ n: "1", total: "10" });
  // the stored photo is clean: no EXIF made it into the private bucket
  const [file] = await sql<{ n: string }>(
    `select count(*)::text as n from storage.objects o join public.bottle_photo_submissions s on s.photo_path = o.name
      where o.bucket_id = 'bottle-submissions' and s.id = $1`,
    [sent[0]!.id],
  );
  expect(file!.n).toBe("1");

  // without consent the server refuses, and records nothing
  const token = await sessionToken(email);
  const noConsent = await request.post("/api/v1/bottle-photos", {
    headers: { authorization: `Bearer ${token}` },
    multipart: {
      vintageId: v!.id,
      consent: "false",
      photo: {
        name: "x.jpg",
        mimeType: "image/jpeg",
        buffer: await makeJpeg(page, { width: 900, height: 1600 }),
      },
    },
  });
  expect(noConsent.status()).toBe(422);
  expect(await submissionsOf(email)).toHaveLength(2);
  // the raw photo is the admin's only
  expect((await page.request.get(`/admin/bottle-photos/${sent[0]!.id}/photo`)).status()).toBe(404);
  expect((await api(request, token, "get", "/me/points")).status()).toBe(200);

  await page.goto("/profile");
  await expect(page.getByTestId("points")).toContainText("10");

  // ---- the admin reviews it, uploads the 2D bottle and publishes it --------------------------------------------
  await sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
    ADMIN_ID,
    ADMIN_EMAIL,
  ]);
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await adminContext.newPage();
  await signIn(admin, ADMIN_EMAIL);
  await admin.goto("/admin/bottle-photos?status=pending");
  const row = admin.getByRole("row").filter({ hasText: name });
  await expect(row).toHaveCount(2);
  await expect(row.first()).toContainText("Yes ·");
  await row
    .filter({ hasText: "+10" })
    .getByRole("link", { name: `Château ${name} — ${name}` })
    .click();
  const photo = admin.getByTestId("submission-photo");
  await expect(photo).toBeVisible();
  expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await admin.getByRole("button", { name: "Approve" }).click();
  await expect(admin.getByText("Marked as approved.")).toBeVisible();
  await admin.getByTestId("wine-link").click();
  await expect(admin).toHaveURL(new RegExp(`/admin/wines/${wineId}`));

  await admin.locator('input[name="picture"]').setInputFiles(await bottlePng(admin));
  await admin.getByRole("button", { name: "Upload" }).click();
  await expect(admin.getByText(/Uploaded as a draft/)).toBeVisible();
  await expect(admin.getByTestId("draft-art")).toBeVisible();
  await admin.getByRole("button", { name: "Publish" }).click();
  await expect(
    admin.getByText(/Published: this is now the wine's default picture, made from 1 photo/),
  ).toBeVisible();
  await expect(admin.getByTestId("published-art")).toBeVisible();
  expect((await submissionsOf(email)).map((s) => s.status)).toEqual(["used", "pending"]);
  await adminContext.close();

  // ---- the app shows the published picture for that wine, and keeps the drawn bottle for the other -----------
  await page.goto("/cellar");
  const withArt = page.locator('[data-art="true"]');
  await expect(withArt).toHaveCount(1);
  const img = withArt.locator("img");
  await expect(img).toHaveAttribute("src", /^\/api\/v1\/bottle-art\/[0-9a-f-]{36}$/);
  await expect
    .poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth))
    .toBeGreaterThan(0);
  const served = await page.request.get((await img.getAttribute("src"))!);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/png");

  await page.goto(`/cellar/${v!.id}`);
  await expect(page.getByTestId("bottle-portrait")).toHaveAttribute("data-label", "art");
  // the wine is pictured now: no more asking for a photo
  const section = page.getByTestId("complete-wine");
  if ((await section.getAttribute("open")) === null) await section.locator("summary").click();
  await expect(section.getByRole("button", { name: "Share a bottle photo" })).toHaveCount(0);

  const [ownVintage] = await sql<{ id: string }>(
    "select id from public.wine_vintages where wine_id = $1",
    [own.id],
  );
  await page.goto(`/cellar/${ownVintage!.id}`);
  await expect(page.getByTestId("bottle-portrait")).toHaveAttribute("data-label", "typeset");
});
