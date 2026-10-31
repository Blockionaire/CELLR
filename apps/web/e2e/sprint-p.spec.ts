import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { api, apiClient, arrive, makeJpeg, sessionToken, signIn, sql, stamp } from "./helpers";

/**
 * Sprint P: the demand-driven 2D bottle library, for every wine. A person sends a photo of a whole bottle (with
 * consent, points once per wine); the admin reviews it, uploads a finished 2D bottle picture and publishes it on that
 * wine. A household's own wine keeps its picture to itself; a catalogue wine's picture is shared like the catalogue.
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

const vintageOf = async (wineId: string) =>
  (
    await sql<{ id: string }>("select id from public.wine_vintages where wine_id = $1", [wineId])
  )[0]!.id;

/** From the wine's page: share a bottle photo, with the explicit yes. Returns the sheet. */
async function sharePhoto(page: Page, vintageId: string, words: string) {
  await page.goto(`/cellar/${vintageId}`);
  const more = page.getByTestId("complete-wine");
  if ((await more.getAttribute("open")) === null) await more.locator("summary").click();
  await more.getByRole("button", { name: "Share a bottle photo" }).click();
  const sheet = page.getByRole("dialog", { name: "A photo of the bottle" });
  const send = sheet.getByRole("button", { name: "Send photo" });
  await expect(send).toBeDisabled();
  await sheet.locator('input[type="file"]').setInputFiles({
    name: "IMG_0042.jpg",
    mimeType: "image/jpeg",
    buffer: await makeJpeg(page, { width: 900, height: 1600, words, exif: true }),
  });
  // a photo alone is not enough: the explicit yes is needed
  await expect(send).toBeDisabled();
  await sheet.getByRole("checkbox", { name: /CELLR may use this photo/ }).check();
  await send.click();
  await expect(sheet.getByText("Thank you!")).toBeVisible();
  return sheet;
}

async function asAdmin(browser: Browser) {
  await sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
    ADMIN_ID,
    ADMIN_EMAIL,
  ]);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await context.newPage();
  await signIn(admin, ADMIN_EMAIL);
  return { admin, close: () => context.close() };
}

/** In the admin: open the photo, approve it, go to the wine's editor, upload a picture and publish it. */
async function publishFromPhoto(admin: Page, submissionId: string, wineId: string) {
  await admin.goto(`/admin/bottle-photos/${submissionId}`);
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
  const draftSrc = await admin.getByTestId("draft-art").getAttribute("src");
  await admin.getByRole("button", { name: "Publish" }).click();
  await expect(
    admin.getByText(/Published: this is now the wine's default picture, made from 1 photo/),
  ).toBeVisible();
  await expect(admin.getByTestId("published-art")).toBeVisible();
  const [art] = await sql<{ id: string }>(
    "select id from public.wine_bottle_art where wine_id = $1 and published_at is not null",
    [wineId],
  );
  return { artId: art!.id, draftSrc: draftSrc! };
}

test("a household's own wine gets its own 2D bottle, seen only by that household", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const { email, household } = await arrive(page, "ownbottle");
  const { call } = await apiClient(request, email);
  // a wine nobody has heard of: it is the household's own, not in the catalogue
  const name = `Cuvée Inconnue ${stamp()}`;
  const own = (
    await call<{ id: string }>(
      "post",
      "/wines",
      { producer: "Domaine Secret", name, type: "white", countryCode: "FR" },
      201,
    )
  ).body;
  await call(
    "post",
    "/bottles",
    { wineId: own.id, year: 2021, quantity: 1, locationId: null },
    201,
  );
  const [status] = await sql<{ status: string }>("select status from public.wines where id = $1", [
    own.id,
  ]);
  expect(status!.status).toBe("provisional");
  const vintageId = await vintageOf(own.id);

  // ---- the person sends a photo: points once ----------------------------------------------------------------
  let sheet = await sharePhoto(page, vintageId, "Bottle");
  await expect(sheet.getByText("You earned 10 points.", { exact: false })).toBeVisible();
  await expect(sheet.getByTestId("points-total")).toHaveText("You have 10 points.");
  await sheet.getByRole("button", { name: "Done" }).click();
  sheet = await sharePhoto(page, vintageId, "Again");
  await expect(sheet.getByText(/already earned points for this wine/)).toBeVisible();
  await expect(sheet.getByTestId("points-total")).toHaveText("You have 10 points.");
  await sheet.getByRole("button", { name: "Done" }).click();
  const sent = await submissionsOf(email);
  expect(sent.map((s) => [s.status, s.reward_points, s.consent])).toEqual([
    ["pending", 10, true],
    ["pending", null, true],
  ]);

  // without consent the server refuses and records nothing; the raw photo is the admin's only
  const token = await sessionToken(email);
  const noConsent = await request.post("/api/v1/bottle-photos", {
    headers: { authorization: `Bearer ${token}` },
    multipart: {
      vintageId,
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
  expect((await page.request.get(`/admin/bottle-photos/${sent[0]!.id}/photo`)).status()).toBe(404);

  // ---- the admin publishes straight onto the household's wine, no catalogue wine needed ---------------------
  const { admin, close } = await asAdmin(browser);
  await admin.goto("/admin/bottle-photos?status=pending");
  const row = admin.getByRole("row").filter({ hasText: name });
  await expect(row).toHaveCount(2);
  await admin.goto(`/admin/bottle-photos/${sent[0]!.id}`);
  await expect(admin.getByText(household).first()).toBeVisible();
  await expect(admin.getByText(/its picture is seen only by/)).toBeVisible();
  const { artId, draftSrc } = await publishFromPhoto(admin, sent[0]!.id, own.id);
  await expect(
    admin.getByText(/Its published picture is shown only to that household/),
  ).toBeVisible();
  expect(
    await sql<{ status: string }>("select status from public.wines where id = $1", [own.id]),
  ).toEqual([{ status: "provisional" }]);
  // the admin's list holds household wines too, with their household
  await admin.goto(`/admin/wines?scope=household&q=${encodeURIComponent(name)}`);
  await expect(admin.getByRole("row").filter({ hasText: name })).toContainText(
    `Household: ${household}`,
  );
  await admin.goto(`/admin/wines?scope=catalogue&q=${encodeURIComponent(name)}`);
  await expect(admin.getByText("No wines here.")).toBeVisible();

  // ---- the household sees it in its cellar and on the wine's page ---------------------------------------------
  await page.goto("/cellar");
  const card = page.locator('[data-art="true"]');
  await expect(card).toHaveCount(1);
  const src = (await card.locator("img").getAttribute("src"))!;
  expect(src).toBe(`/api/v1/bottle-art/${artId}`);
  await expect
    .poll(() => card.locator("img").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth))
    .toBeGreaterThan(0);
  const served = await page.request.get(src);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/png");
  // a household's own picture is never kept by the browser
  expect(served.headers()["cache-control"]).toBe("no-store");
  await page.goto(`/cellar/${vintageId}`);
  await expect(page.getByTestId("bottle-portrait")).toHaveAttribute("data-label", "art");

  // ---- another household cannot get it, even with the same wine typed in --------------------------------------
  const otherContext = await browser.newContext(test.info().project.use as BrowserContextOptions);
  const other = await otherContext.newPage();
  const stranger = await arrive(other, "otherbottle");
  const { call: strangerCall } = await apiClient(request, stranger.email);
  const twin = (
    await strangerCall<{ id: string }>(
      "post",
      "/wines",
      { producer: "Domaine Secret", name, type: "white", countryCode: "FR" },
      201,
    )
  ).body;
  await strangerCall(
    "post",
    "/bottles",
    { wineId: twin.id, year: 2021, quantity: 1, locationId: null },
    201,
  );
  expect(twin.id).not.toBe(own.id);
  const strangerToken = await sessionToken(stranger.email);
  expect((await api(request, strangerToken, "get", `/bottle-art/${artId}`)).status()).toBe(404);
  expect((await other.request.get(`/api/v1/bottle-art/${artId}`)).status()).toBe(404);
  await other.goto(`/cellar/${await vintageOf(twin.id)}`);
  await expect(other.getByTestId("bottle-portrait")).toHaveAttribute("data-label", "typeset");
  // nobody gets the admin's draft preview or the raw photo
  expect((await other.request.get(draftSrc)).status()).toBe(404);
  await otherContext.close();

  // ---- taking it off restores the household's own picture -------------------------------------------------------
  await admin.goto(`/admin/wines/${own.id}`);
  await admin.getByRole("button", { name: /Take it off/ }).click();
  await expect(admin.getByText(/Taken off/)).toBeVisible();
  await close();
  expect((await page.request.get(src)).status()).toBe(404);
  await page.goto(`/cellar/${vintageId}`);
  await expect(page.getByTestId("bottle-portrait")).toHaveAttribute("data-label", "typeset");
  await page.goto("/cellar");
  await expect(page.locator('[data-art="true"]')).toHaveCount(0);
});

test("a catalogue wine's 2D bottle is shared with every household that has it", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const name = `Grand Vin ${stamp()}`;
  const wineId = await catalogueWine(name);
  const { email } = await arrive(page, "catbottle");
  const { call } = await apiClient(request, email);
  await call("post", "/bottles", { wineId, year: 2016, quantity: 2, locationId: null }, 201);
  const vintageId = await vintageOf(wineId);

  // another household's photo of its own wine: it must never become a source for this catalogue wine
  const otherContext = await browser.newContext(test.info().project.use as BrowserContextOptions);
  const other = await otherContext.newPage();
  const neighbour = await arrive(other, "catneighbour");
  const { call: nCall } = await apiClient(request, neighbour.email);
  const unrelated = (
    await nCall<{ id: string }>(
      "post",
      "/wines",
      { producer: "Domaine Voisin", name, type: "red", countryCode: "FR" },
      201,
    )
  ).body;
  expect(unrelated.id).not.toBe(wineId);
  await nCall(
    "post",
    "/bottles",
    { wineId: unrelated.id, year: 2016, quantity: 1, locationId: null },
    201,
  );
  const lookalike = await sharePhoto(other, await vintageOf(unrelated.id), "Lookalike");
  await lookalike.getByRole("button", { name: "Done" }).click();
  const [unrelatedPhoto] = await submissionsOf(neighbour.email);
  // and the neighbour also owns the catalogue wine itself
  await nCall("post", "/bottles", { wineId, year: 2016, quantity: 1, locationId: null }, 201);

  const sheet = await sharePhoto(page, vintageId, "Catalogue");
  await expect(sheet.getByText("You earned 10 points.", { exact: false })).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).click();
  const [sent] = await submissionsOf(email);

  const { admin, close } = await asAdmin(browser);
  await admin.goto(`/admin/bottle-photos/${sent!.id}`);
  await expect(admin.getByText(/its picture is shared with everyone who has it/)).toBeVisible();
  // the editor offers only photos of this wine as sources
  await admin.goto(`/admin/wines/${wineId}`);
  await expect(admin.locator(`a[href="/admin/bottle-photos/${unrelatedPhoto!.id}"]`)).toHaveCount(
    0,
  );
  const { artId } = await publishFromPhoto(admin, sent!.id, wineId);
  await close();

  // both households see it; a catalogue picture may be kept by the browser
  for (const viewer of [page, other]) {
    await viewer.goto("/cellar");
    const card = viewer.locator('[data-art="true"]');
    await expect(card.first().locator("img")).toHaveAttribute("src", `/api/v1/bottle-art/${artId}`);
    const served = await viewer.request.get(`/api/v1/bottle-art/${artId}`);
    expect(served.status()).toBe(200);
    expect(served.headers()["cache-control"]).toBe("private, max-age=31536000, immutable");
  }
  // the neighbour's own wine of the same name is not linked to it by its name
  await other.goto(`/cellar/${await vintageOf(unrelated.id)}`);
  await expect(other.getByTestId("bottle-portrait")).toHaveAttribute("data-label", "typeset");
  await otherContext.close();
});
