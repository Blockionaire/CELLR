import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiClient, arrive, makeJpeg, signIn, sql, stamp } from "./helpers";

/**
 * Sprint R: the Wine Master Database. A person sends one contribution of three photos (one yes, points once); the
 * admin sees every photo. In the master database the admin finds a household's own wine, links it to the catalogue
 * wine after comparing them side by side, corrects the catalogue record (audited, bottles untouched), adds and
 * removes a vintage, and shares a curated label. Nothing is linked or changed by itself.
 */
test.skip(({ isMobile }) => !isMobile, "the phone");

const ADMIN_ID = "00000000-0000-4000-8000-00000000ad01";
const ADMIN_EMAIL = "feedback-admin@cellr.invalid";

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

/** A label image as the admin would upload it: a PNG drawn in the browser. */
async function labelPng(page: Page) {
  const base64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 800;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#f4ecd8";
    ctx.fillRect(0, 0, 600, 800);
    ctx.fillStyle = "#5a1e2a";
    ctx.fillRect(60, 300, 480, 120);
    return c.toDataURL("image/png").split(",")[1]!;
  });
  return { name: "label.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

/** The household's own wine with one bottle, made over the API like the app does. */
async function ownWine(request: Parameters<typeof apiClient>[0], email: string, name: string) {
  const { call } = await apiClient(request, email);
  const own = (
    await call<{ id: string }>(
      "post",
      "/wines",
      { producer: `Château Maître ${name}`, name, type: "red", countryCode: "FR" },
      201,
    )
  ).body;
  await call(
    "post",
    "/bottles",
    { wineId: own.id, year: 2021, quantity: 1, locationId: null },
    201,
  );
  const [v] = await sql<{ id: string }>("select id from public.wine_vintages where wine_id = $1", [
    own.id,
  ]);
  return { wineId: own.id, vintageId: v!.id };
}

test("one contribution of three photos: one yes, points once, every photo for the admin", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const { email } = await arrive(page, "threephotos");
  const { vintageId } = await ownWine(request, email, `Trois Photos ${stamp()}`);

  await page.goto(`/cellar/${vintageId}`);
  const more = page.getByTestId("complete-wine");
  if ((await more.getAttribute("open")) === null) await more.locator("summary").click();
  await more.getByRole("button", { name: "Share a bottle photo" }).click();
  const sheet = page.getByRole("dialog", { name: "A photo of the bottle" });
  const input = sheet.locator('input[type="file"]');
  for (const [i, words] of ["Bottle", "Front", "Back"].entries()) {
    await input.setInputFiles({
      name: `IMG_00${i}.jpg`,
      mimeType: "image/jpeg",
      buffer: await makeJpeg(page, { width: 900, height: 1600, words }),
    });
    await expect(sheet.getByTestId("bottle-photo-previews").locator("img")).toHaveCount(i + 1);
  }
  // three is the most: no fourth photo can be added; one can be taken away again
  await expect(sheet.getByRole("button", { name: /Add another photo/ })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Remove this photo" }).last().click();
  await expect(sheet.getByTestId("bottle-photo-previews").locator("img")).toHaveCount(2);
  await input.setInputFiles({
    name: "IMG_009.jpg",
    mimeType: "image/jpeg",
    buffer: await makeJpeg(page, { width: 900, height: 1600, words: "Label" }),
  });
  const send = sheet.getByRole("button", { name: "Send 3 photos" });
  await expect(send).toBeDisabled();
  await sheet.getByRole("checkbox", { name: /CELLR may use these photos/ }).check();
  await send.click();
  await expect(sheet.getByText("Thank you!")).toBeVisible();
  await expect(sheet.getByText("You earned 10 points.", { exact: false })).toBeVisible();

  const rows = await sql<{ id: string; photos: number; reward: number | null }>(
    `select s.id, (select count(*)::int from public.bottle_photo_images i where i.submission_id = s.id) as photos,
            s.reward_points as reward
       from public.bottle_photo_submissions s join auth.users u on u.id = s.user_id where u.email = $1`,
    [email],
  );
  expect(rows).toEqual([{ id: rows[0]!.id, photos: 3, reward: 10 }]);

  const { admin, close } = await asAdmin(browser);
  await admin.goto(`/admin/bottle-photos/${rows[0]!.id}`);
  const photos = admin.getByTestId("submission-photo");
  await expect(photos).toHaveCount(3);
  for (const img of await photos.all()) {
    await expect(img).toBeVisible();
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
      .toBeGreaterThan(0);
  }
  await close();
});

test("the master database: find, link after comparing, correct with an audit, vintages and a shared label", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const m = stamp();
  const name = `Grand Vin Maître ${m}`;
  const [p] = await sql<{ id: string }>(
    `insert into public.producers (name, country_code, status, origin)
     values ($1, 'FR', 'canonical', 'verified') returning id`,
    [`Château Maître ${name}`],
  );
  const [cw] = await sql<{ id: string }>(
    `insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
     values ($1, $2, 'red', 'FR', 'Bordeaux', 'canonical', 'verified') returning id`,
    [p!.id, name],
  );
  const canonicalId = cw!.id;
  await sql("insert into public.wine_vintages (wine_id, year) values ($1, 2016)", [canonicalId]);
  const { email, household } = await arrive(page, "master");
  // the household's own wine, named a little differently, so nothing links it to the catalogue by itself
  const own = await ownWine(request, email, `${name} maison`);
  const bottlesBefore = await sql(
    "select id, vintage_id, status from public.bottles where household_id = (select household_id from public.bottles b join public.wine_vintages v on v.id = b.vintage_id where v.wine_id = $1 limit 1) order by id",
    [own.wineId],
  );

  const { admin, close } = await asAdmin(browser);

  // ---- the list: both wines, scoped and filtered in the database -------------------------------------------------
  await admin.goto("/admin");
  await admin
    .getByRole("navigation", { name: "Admin" })
    .getByRole("link", { name: "Wine Master Database" })
    .click();
  await expect(admin.getByRole("heading", { name: "Wine Master Database" })).toBeVisible();
  await admin.getByLabel("Search wines").fill(name);
  await admin.getByRole("button", { name: "Search" }).click();
  await expect(admin.getByTestId("master-total")).toContainText("2 wines");
  await admin.goto(`/admin/wines?scope=household&f=unlinked&q=${encodeURIComponent(name)}`);
  const ownRow = admin.getByRole("row").filter({ hasText: name });
  await expect(ownRow).toHaveCount(1);
  await expect(ownRow).toContainText(`Household: ${household}`);
  await expect(ownRow).toContainText("Not linked");

  // ---- linking: only after comparing side by side, with a reason and an explicit yes ---------------------------
  await ownRow.getByRole("link").click();
  await expect(admin).toHaveURL(new RegExp(`/admin/wines/${own.wineId}`));
  await expect(admin.getByTestId("scope").first()).toContainText(`household wine of ${household}`);
  const links = admin.getByRole("region", { name: "Catalogue links" });
  await links.getByLabel("Search the catalogue").fill(name);
  await links.getByRole("button", { name: "Find catalogue wines" }).click();
  await admin.getByRole("link", { name: new RegExp(`Compare with .*${name}`) }).click();
  const compare = admin.getByTestId("link-compare");
  await expect(compare).toContainText("This household wine");
  await expect(compare).toContainText("Catalogue wine");
  await compare
    .getByLabel("Why they are the same wine (required)")
    .fill("Same producer, name and label");
  await compare.getByRole("button", { name: "Link to this catalogue wine" }).click();
  await expect(admin.getByText(/Not linked: compare both wines/)).toBeVisible();
  expect(
    await sql("select 1 from public.wine_links where source_wine_id = $1", [own.wineId]),
  ).toHaveLength(0);
  await links.getByLabel("Search the catalogue").fill(name);
  await links.getByRole("button", { name: "Find catalogue wines" }).click();
  await admin.getByRole("link", { name: new RegExp(`Compare with .*${name}`) }).click();
  await compare
    .getByLabel("Why they are the same wine (required)")
    .fill("Same producer, name and label");
  await compare.getByRole("checkbox", { name: /I verified these are the same wine/ }).check();
  await compare.getByRole("button", { name: "Link to this catalogue wine" }).click();
  await expect(admin.getByText(/Linked: this household wine is verified/)).toBeVisible();
  await expect(admin.getByTestId("current-link")).toContainText(name);
  expect(
    await sql<{ canonical: string; by: string }>(
      "select canonical_wine_id as canonical, linked_by as by from public.wine_links where source_wine_id = $1",
      [own.wineId],
    ),
  ).toEqual([{ canonical: canonicalId, by: ADMIN_ID }]);
  // a household wine gets no shared labels; its vintage with a bottle cannot be removed
  await expect(admin.getByText(/Shared labels are for catalogue wines only/)).toBeVisible();
  await expect(admin.getByTestId("vintage-2021").getByLabel("Year")).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(
    admin.getByRole("region", { name: "Vintages" }).getByRole("button", { name: "Remove vintage" }),
  ).toHaveCount(0);

  // ---- the catalogue wine: correct its region, with an audit; bottles stay as they are --------------------------
  await admin.goto(`/admin/wines/${canonicalId}`);
  await expect(admin.getByTestId("scope").first()).toContainText("shared catalogue");
  await expect(admin.getByRole("region", { name: "Catalogue links" })).toContainText(household);
  const details = admin.getByTestId("wine-details");
  await details.getByLabel("Region").fill("Pauillac");
  await details.getByLabel("Reason (internal, optional)").fill("the label says Pauillac");
  await details.getByRole("button", { name: "Save wine details" }).click();
  await expect(admin.getByText("Wine details saved.")).toBeVisible();
  const history = admin.getByRole("region", { name: "History" });
  await expect(history).toContainText("Details changed");
  await expect(history).toContainText("region: Bordeaux → Pauillac");
  await expect(history).toContainText("the label says Pauillac");
  expect(await sql("select region from public.wines where id = $1", [canonicalId])).toEqual([
    { region: "Pauillac" },
  ]);
  expect(
    await sql(
      "select id, vintage_id, status from public.bottles where household_id = (select household_id from public.bottles b join public.wine_vintages v on v.id = b.vintage_id where v.wine_id = $1 limit 1) order by id",
      [own.wineId],
    ),
  ).toEqual(bottlesBefore);

  // ---- vintages: add one, a duplicate is refused, an unused one can be removed --------------------------------
  const add = admin.getByTestId("vintage-create");
  await add.getByLabel("New vintage (year, or NV)").fill("2019");
  await add.getByRole("button", { name: "Add vintage" }).click();
  await expect(admin.getByText("Vintage added.")).toBeVisible();
  await add.getByLabel("New vintage (year, or NV)").fill("2019");
  await add.getByRole("button", { name: "Add vintage" }).click();
  await expect(admin.getByText(/would duplicate an existing/)).toBeVisible();
  const v2019 = admin.getByRole("row").filter({ has: admin.getByTestId("vintage-2019") });
  await v2019.getByRole("checkbox").check();
  await v2019.getByRole("button", { name: "Remove vintage" }).click();
  await expect(admin.getByText("Vintage removed.")).toBeVisible();
  expect(
    await sql("select year from public.wine_vintages where wine_id = $1 order by year", [
      canonicalId,
    ]),
  ).toEqual([{ year: 2016 }]);

  // ---- a curated shared label: uploaded as a draft, then shared --------------------------------------------------
  const labels = admin.getByRole("region", { name: "Labels" });
  await labels.locator('input[name="label"]').setInputFiles(await labelPng(admin));
  await labels.getByLabel(/Source/).fill("Producer press kit, licensed");
  await labels.getByRole("button", { name: "Add shared label" }).click();
  await expect(admin.getByText(/Label uploaded as a draft/)).toBeVisible();
  await admin.getByRole("button", { name: "Share label" }).click();
  await expect(admin.getByText(/Label published for everyone/)).toBeVisible();
  expect(
    await sql<{ side: string; published: boolean }>(
      "select side::text, published_at is not null as published from public.catalog_labels where wine_id = $1",
      [canonicalId],
    ),
  ).toEqual([{ side: "front", published: true }]);
  await expect(history).toContainText("Label published");
  await close();
});
