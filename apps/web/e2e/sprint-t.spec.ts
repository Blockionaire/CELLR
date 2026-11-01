import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { apiClient, arrive, makeJpeg, sessionToken, signIn, sql, stamp } from "./helpers";

/**
 * Sprint T: the bottle-photo contribution, from where the person stands with each wine. Eligible: the 1–3 photo request
 * with +10 points; sent: a quiet "photos received" with the points actually earned, on every device and every vintage;
 * a second contribution is refused by the server (also two at once), its files removed; after a rejection new photos
 * are welcome without a second reward. Home invites for one eligible wine of the cellar (dismissible), and the
 * bottle-added screen offers it only when nothing was sent for that wine.
 */
test.skip(({ isMobile }) => !isMobile, "the phone");

const ADMIN_ID = "00000000-0000-4000-8000-00000000ad01";

/** A catalogue wine with the given vintages. */
async function catalogueWine(name: string, years: number[]) {
  const [p] = await sql<{ id: string }>(
    `insert into public.producers (name, country_code, status, origin)
     values ($1, 'FR', 'canonical', 'verified') returning id`,
    [`Domaine ${name}`],
  );
  const [w] = await sql<{ id: string }>(
    `insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
     values ($1, $2, 'red', 'FR', 'Loire', 'canonical', 'verified') returning id`,
    [p!.id, name],
  );
  for (const year of years)
    await sql("insert into public.wine_vintages (wine_id, year) values ($1, $2)", [w!.id, year]);
  return w!.id;
}

const vintage = async (wineId: string, year: number) =>
  (
    await sql<{ id: string }>(
      "select id from public.wine_vintages where wine_id = $1 and year = $2",
      [wineId, year],
    )
  )[0]!.id;

const userOf = async (email: string) =>
  (await sql<{ id: string }>("select id from auth.users where email = $1", [email]))[0]!.id;

const submissions = (userId: string) =>
  sql<{ id: string; status: string; reward: number | null }>(
    `select id, status, reward_points as reward from public.bottle_photo_submissions
      where user_id = $1 order by created_at`,
    [userId],
  );

/** The wine page's "complete this wine" part, opened. */
async function wineSection(page: Page, vintageId: string) {
  await page.goto(`/cellar/${vintageId}`);
  const more = page.getByTestId("complete-wine");
  if ((await more.getAttribute("open")) === null) await more.locator("summary").click();
  return more;
}

/** In an open bottle-photo sheet: one photo, the explicit yes, send. */
async function sendInSheet(page: Page, words: string) {
  const sheet = page.getByRole("dialog", { name: "A photo of the bottle" });
  await sheet.locator('input[type="file"]').setInputFiles({
    name: "IMG_0101.jpg",
    mimeType: "image/jpeg",
    buffer: await makeJpeg(page, { width: 900, height: 1600, words }),
  });
  await sheet.getByRole("checkbox", { name: /CELLR may use these photos/ }).check();
  await sheet.getByRole("button", { name: "Send photo" }).click();
  await expect(sheet.getByText("Thank you!")).toBeVisible();
  return sheet;
}

async function postPhoto(page: Page, token: string, vintageId: string, name: string) {
  return page.request.post("/api/v1/bottle-photos", {
    headers: { authorization: `Bearer ${token}` },
    multipart: {
      vintageId,
      consent: "true",
      photo: {
        name,
        mimeType: "image/jpeg",
        buffer: await makeJpeg(page, { width: 900, height: 1600, words: name }),
      },
    },
  });
}

test("eligible → photos received, kept across reloads, vintages and devices; one active contribution, points once", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const m = stamp();
  const wineId = await catalogueWine(`Statut ${m}`, [2016, 2018]);
  const { email } = await arrive(page, "contrib");
  const { call } = await apiClient(page.request, email);
  await call("post", "/bottles", { wineId, year: 2016, quantity: 1, locationId: null }, 201);
  await call("post", "/bottles", { wineId, year: 2018, quantity: 1, locationId: null }, 201);
  const v16 = await vintage(wineId, 2016);
  const v18 = await vintage(wineId, 2018);
  const userId = await userOf(email);

  // ---- eligible: the request, with the one-time reward ----------------------------------------------------------
  let more = await wineSection(page, v16);
  const ask = more.getByTestId("bottle-photo-ask");
  await expect(ask).toContainText("Help CELLR picture this wine");
  await expect(ask).toContainText("+10 points");
  await ask.getByRole("button", { name: "Share a bottle photo" }).click();
  const sheet = await sendInSheet(page, "First");
  await expect(sheet.getByText(/You earned 10 points/)).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).click();

  // ---- received: instead of the request, with what the ledger holds -----------------------------------------------
  const received = more.getByTestId("bottle-photo-received");
  await expect(received).toContainText("Photos received");
  await expect(received).toContainText("You earned 10 points for them.");
  await expect(more.getByRole("button", { name: "Share a bottle photo" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/shots/sprint-t-received.png" });
  await page.reload();
  more = await wineSection(page, v16);
  await expect(more.getByTestId("bottle-photo-received")).toBeVisible();
  // the same wine, another vintage
  more = await wineSection(page, v18);
  await expect(more.getByTestId("bottle-photo-received")).toBeVisible();
  // another device
  const other = await browser.newContext(test.info().project.use as BrowserContextOptions);
  const phone2 = await other.newPage();
  await signIn(phone2, email);
  const more2 = await wineSection(phone2, v18);
  await expect(more2.getByTestId("bottle-photo-received")).toContainText("You earned 10 points");
  await other.close();

  // ---- the server refuses a second contribution, also two at once, and keeps no files of the refused ones ----------
  const token = await sessionToken(email);
  expect((await postPhoto(page, token, v18, "again.jpg")).status()).toBe(409);
  const wine2 = await catalogueWine(`Pair ${m}`, [2019]);
  await call("post", "/bottles", { wineId: wine2, year: 2019, quantity: 1, locationId: null }, 201);
  const v2 = await vintage(wine2, 2019);
  const both = await Promise.all([
    postPhoto(page, token, v2, "one.jpg"),
    postPhoto(page, token, v2, "two.jpg"),
  ]);
  expect(both.map((r) => r.status()).sort()).toEqual([200, 409]);
  const files = await sql<{ n: string }>(
    "select count(*) as n from storage.objects where bucket_id = 'bottle-submissions' and name like $1",
    [`${userId}/%`],
  );
  const kept = await sql<{ n: string }>(
    `select count(*) as n from public.bottle_photo_images i
       join public.bottle_photo_submissions s on s.id = i.submission_id where s.user_id = $1`,
    [userId],
  );
  expect(files[0]!.n).toBe(kept[0]!.n); // every stored file belongs to a recorded contribution
  expect(await submissions(userId)).toHaveLength(2);

  // ---- rejected: new photos welcome, no second reward promised or paid -------------------------------------------
  const [first] = await submissions(userId);
  await sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
    ADMIN_ID,
    "feedback-admin@cellr.invalid",
  ]);
  await sql("select public.admin_review_bottle_photo($1, 'rejected', null, 'blurry', $2)", [
    first!.id,
    ADMIN_ID,
  ]);
  more = await wineSection(page, v18);
  const again = more.getByTestId("bottle-photo-ask");
  await expect(again).toHaveAttribute("data-state", "again");
  await expect(again).toContainText("Your earlier photos couldn't be used");
  await expect(again).toContainText("You already earned your points for this wine");
  await expect(again).not.toContainText("+10 points");
  await again.getByRole("button", { name: "Share a bottle photo" }).click();
  const sheet2 = await sendInSheet(page, "Better");
  await expect(sheet2.getByText(/already earned points for this wine/)).toBeVisible();
  await sheet2.getByRole("button", { name: "Done" }).click();
  await expect(more.getByTestId("bottle-photo-received")).toBeVisible();
  const ledger = await sql<{ total: string }>(
    "select coalesce(sum(points), 0) as total from public.account_points where user_id = $1",
    [userId],
  );
  expect(ledger[0]!.total).toBe("20"); // 10 for each of the two wines, once
  expect((await submissions(userId)).map((s) => [s.status, s.reward])).toEqual([
    ["rejected", 10],
    ["pending", 10],
    ["pending", null],
  ]);
});

test("Home invites for one eligible wine of the cellar, opens its sheet, and 'Not now' holds on every device", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const m = stamp();
  const eligible = await catalogueWine(`Invite ${m}`, [2020]);
  const pictured = await catalogueWine(`Pictured ${m}`, [2021]);
  // the most recently added wine already has a published picture: it is never the one invited
  await sql(
    `insert into public.wine_bottle_art (wine_id, path, content_type, width, height, published_at)
     values ($1::uuid, $1::text || '/art.png', 'image/png', 400, 1200, now())`,
    [pictured],
  );
  const { email } = await arrive(page, "invite");
  const { call } = await apiClient(page.request, email);
  await call(
    "post",
    "/bottles",
    { wineId: eligible, year: 2020, quantity: 1, locationId: null },
    201,
  );
  await call(
    "post",
    "/bottles",
    { wineId: pictured, year: 2021, quantity: 1, locationId: null },
    201,
  );

  await page.goto("/");
  const card = page.getByTestId("bottle-photo-invite");
  await expect(card).toBeVisible();
  await expect(card).toContainText(`Invite ${m}`);
  await expect(card).not.toContainText(`Pictured ${m}`);
  await expect(card).toContainText("+10 points");
  await expect(page.getByTestId("bottle-photo-invite")).toHaveCount(1);
  await page.screenshot({ path: "test-results/shots/sprint-t-home-invite.png", fullPage: true });

  // the button opens the sheet for exactly that wine
  await card.getByRole("button", { name: "Add bottle photos" }).click();
  const sheet = page.getByRole("dialog", { name: "A photo of the bottle" });
  await expect(sheet).toContainText(`Domaine Invite ${m} Invite ${m}`);
  await sheet.getByRole("button", { name: "Close" }).click();

  // "Not now": gone, also after a reload and on another device
  await card.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByTestId("bottle-photo-invite")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (
          await sql<{ at: string | null }>(
            `select p.bottle_photo_invite_dismissed_at as at from public.profiles p
             join auth.users u on u.id = p.id where u.email = $1`,
            [email],
          )
        )[0]!.at,
    )
    .not.toBeNull();
  await page.reload();
  await expect(page.getByTestId("bottle-photo-invite")).toHaveCount(0);
  const other = await browser.newContext(test.info().project.use as BrowserContextOptions);
  const phone2 = await other.newPage();
  await signIn(phone2, email);
  await phone2.goto("/");
  await expect(phone2.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(phone2.getByTestId("bottle-photo-invite")).toHaveCount(0);
  await other.close();
});

test("after adding bottles: a separate whole-bottle offer only while nothing was sent for that wine", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const m = stamp();
  const wineId = await catalogueWine(`Added ${m}`, [2017, 2019]);
  const { email } = await arrive(page, "postadd");
  const { call } = await apiClient(page.request, email);
  await call("post", "/bottles", { wineId, year: 2017, quantity: 1, locationId: null }, 201);

  await page.goto(`/cellar/add?wine=${wineId}&year=2019`);
  await page.getByRole("button", { name: "Add 1 bottle" }).click();
  await expect(page.getByRole("heading", { name: "Added to your cellar." })).toBeVisible();
  const offer = page.getByTestId("bottle-photo-offer");
  await expect(offer).toContainText("Not the label photo");
  await expect(offer).toContainText("+10 points");
  await offer.getByRole("button", { name: "Add bottle photos" }).click();
  const sheet = await sendInSheet(page, "Added");
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("bottle-photo-offer")).toHaveCount(0);

  // the same wine again (another vintage): already sent, so no offer
  await page.goto(`/cellar/add?wine=${wineId}&year=2017`);
  await page.getByRole("button", { name: "Add 1 bottle" }).click();
  await expect(page.getByRole("heading", { name: "Added to your cellar." })).toBeVisible();
  await expect(page.getByRole("link", { name: "See my cellar" })).toBeVisible();
  // the status is read after the screen shows; give it the time it needs to (not) appear
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("bottle-photo-offer")).toHaveCount(0);
  expect(
    await sql(
      "select 1 from public.bottle_photo_submissions s join auth.users u on u.id = s.user_id where u.email = $1",
      [email],
    ),
  ).toHaveLength(1);
});
