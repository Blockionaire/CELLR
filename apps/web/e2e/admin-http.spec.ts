import { expect, test, type Browser, type Page } from "@playwright/test";
import { arrive, makeJpeg, sessionToken, signIn, sql, stamp } from "./helpers";

/**
 * Sprint V: the admin dashboard answers people who are not admins with a REAL 404 (not the not-found page under a
 * streamed 200), for page loads, plain fetches and client-side (RSC) requests alike, and shows them nothing of it.
 * Admins get their pages; signed-out visitors are sent to sign-in as before; the rest of the app is unchanged.
 * Measured on the HTTP status, not on how the page looks.
 */
test.skip(({ isMobile }) => isMobile, "the admin dashboard is desktop-first: the desktop project");

const ADMIN_ID = "00000000-0000-4000-8000-00000000ad01";
const ADMIN_EMAIL = "feedback-admin@cellr.invalid";

async function asAdmin(browser: Browser) {
  await sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
    ADMIN_ID,
    ADMIN_EMAIL,
  ]);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await context.newPage();
  await signIn(admin, ADMIN_EMAIL);
  return { admin, close: () => context.close() };
}

/** A catalogue wine, and a bottle photo of a household's own wine (with its private file). */
async function fixtures() {
  const name = `Grand Admin ${stamp()}`;
  const [p] = await sql<{ id: string }>(
    `insert into public.producers (name, country_code, status, origin) values ($1, 'FR', 'canonical', 'verified') returning id`,
    [`Château ${name}`],
  );
  const [w] = await sql<{ id: string }>(
    `insert into public.wines (producer_id, name, wine_type, status, origin) values ($1, $2, 'red', 'canonical', 'verified') returning id`,
    [p!.id, name],
  );
  return { name, wineId: w!.id };
}

const statuses = async (page: Page, url: string) => ({
  load: (await page.goto(url))?.status(),
  fetch: (await page.request.get(url)).status(),
  rsc: (await page.request.get(url, { headers: { RSC: "1" } })).status(),
});

test("a signed-in person who is not an admin gets a real 404 and nothing of the dashboard", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  const { email } = await arrive(page, "notadmin");
  const { name, wineId } = await fixtures();
  // a bottle photo with its private file, sent by this person (so it is theirs, and still not theirs to see here)
  const [v] = await sql<{ id: string }>(
    "insert into public.wine_vintages (wine_id, year) values ($1, 2016) returning id",
    [wineId],
  );
  const [h] = await sql<{ id: string }>(
    "select household_id as id from public.household_members m join auth.users u on u.id = m.user_id where u.email = $1",
    [email],
  );
  await sql("insert into public.bottles (household_id, vintage_id) values ($1, $2)", [
    h!.id,
    v!.id,
  ]);
  const sent = await page.request.post("/api/v1/bottle-photos", {
    headers: { authorization: `Bearer ${await sessionToken(email)}` },
    multipart: {
      vintageId: v!.id,
      consent: "true",
      photo: {
        name: "a.jpg",
        mimeType: "image/jpeg",
        buffer: await makeJpeg(page, { width: 900, height: 1600 }),
      },
    },
  });
  expect(sent.ok()).toBe(true);
  const [s] = await sql<{ id: string }>(
    "select id from public.bottle_photo_submissions where source_vintage_id = $1",
    [v!.id],
  );

  for (const url of [
    "/admin",
    "/admin/wines",
    `/admin/wines?q=${encodeURIComponent(name)}`,
    `/admin/wines/${wineId}`,
    "/admin/bottle-photos?stage=pending",
    `/admin/bottle-photos/${s!.id}`,
    "/admin/users",
    `/admin/catalog/corrections/${wineId}`,
    "/admin/feedback?category=bug",
  ]) {
    expect(await statuses(page, url), url).toEqual({ load: 404, fetch: 404, rsc: 404 });
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "We couldn't find that page." })).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body, url).not.toContain(name);
    expect(body, url).not.toContain("Wine Master Database");
    // nothing of the dashboard in the HTML either (the requested URL itself is echoed, so ids are not checked)
    const html = await page.content();
    expect(html, url).not.toContain(name);
    expect(html, url).not.toContain("Wine Master Database");
    expect(html, url).not.toContain('aria-label="Admin"');
  }

  // private media and admin actions are refused before they run; nothing changes
  for (const url of [
    `/admin/bottle-photos/${s!.id}/photo`,
    `/admin/wines/${wineId}/labels/00000000-0000-4000-8000-000000000001`,
  ])
    expect((await page.request.get(url)).status(), url).toBe(404);
  // a real admin action (the wine details form, its id taken from the admin's own page), posted by this person
  const { admin, close } = await asAdmin(browser);
  await admin.goto(`/admin/wines/${wineId}`);
  // exactly what the admin's browser would post: the form's hidden fields (the action reference, its id and bound
  // wine id, the expected version) plus a changed name
  const hidden = await admin
    .getByTestId("wine-details")
    .locator('input[type="hidden"]')
    .evaluateAll((els) =>
      els.map((e) => [(e as HTMLInputElement).name, (e as HTMLInputElement).value] as const),
    );
  await close();
  expect(hidden.some(([n]) => n.startsWith("$ACTION_"))).toBe(true);
  const action = await page.request.post(`/admin/wines/${wineId}`, {
    headers: { origin: "http://localhost:3100" },
    multipart: {
      ...Object.fromEntries(hidden),
      name: "Hijacked",
      type: "red",
      country: "",
      region: "",
      appellation: "",
      classification: "",
      bottleStyle: "",
      reason: "",
    },
    maxRedirects: 0,
  });
  expect(action.status()).toBe(404);
  expect(await sql("select name from public.wines where id = $1", [wineId])).toEqual([{ name }]);
  const upload = await page.request.post(`/admin/wines/${wineId}/art`, {
    headers: { origin: "http://localhost:3100" },
    multipart: { note: "x" },
  });
  expect(upload.status()).toBe(404);
  expect(
    await sql("select 1 from public.wine_bottle_art where wine_id = $1", [wineId]),
  ).toHaveLength(0);

  // the rest of the app works as before for them
  expect((await page.goto("/"))?.status()).toBe(200);
  expect((await page.goto("/cellar"))?.status()).toBe(200);
  expect((await page.goto("/no-such-page"))?.status()).toBe(404);
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/$/); // signed in: sent home, as before
});

test("an admin gets the dashboard: 200s and working navigation", async ({ browser }) => {
  test.setTimeout(90_000);
  const { name, wineId } = await fixtures();
  const { admin, close } = await asAdmin(browser);
  for (const url of ["/admin", "/admin/wines", `/admin/wines/${wineId}`, "/admin/bottle-photos"])
    expect(await statuses(admin, url), url).toEqual({ load: 200, fetch: 200, rsc: 200 });
  await admin.goto("/admin");
  await admin
    .getByRole("navigation", { name: "Admin" })
    .getByRole("link", { name: "Wine Master Database" })
    .click();
  await expect(admin).toHaveURL(/\/admin\/wines$/);
  await admin.getByLabel("Search wines").fill(name);
  await admin.getByRole("button", { name: "Search" }).click();
  await admin.locator("a[data-row-link]").filter({ hasText: name }).click();
  await expect(admin.getByRole("heading", { level: 1 })).toContainText(name);
  await close();
});

test("signed out: /admin goes to sign-in as every protected page does", async ({ page }) => {
  const response = await page.goto("/admin/wines");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fadmin%2Fwines$/);
  expect(response?.status()).toBe(200);
  expect((await page.request.get("/admin/wines", { maxRedirects: 0 })).status()).toBe(307);
  expect(
    (
      await page.request.get("/admin/bottle-photos/00000000-0000-4000-8000-000000000001/photo", {
        maxRedirects: 0,
      })
    ).status(),
  ).toBe(307);
});
