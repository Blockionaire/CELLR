import { expect, test, type Page } from "@playwright/test";
import { adminContext, freshAdminContext, signInHere } from "./admin-session";

/**
 * Two home-screen apps on one domain: CELLR (/manifest.webmanifest, opens /) and CELLR Admin (/admin.webmanifest,
 * opens /admin). The pages under /admin link the admin's manifest, iOS name and icon; every other page keeps the
 * app's. Both manifests are public and hold no admin data. Chromium is asked through DevTools what it would install
 * from each page: two apps with different ids. (iOS Safari itself cannot be driven here: see
 * docs/sprints/mobile-admin/README.md for the check on an iPhone.)
 */
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

/** The tags iOS and the browser read when the page is added to the home screen. */
const head = (page: Page) =>
  page.evaluate(() => ({
    manifests: [...document.querySelectorAll('link[rel="manifest"]')].map((l) =>
      l.getAttribute("href"),
    ),
    appleTitle: document
      .querySelector('meta[name="apple-mobile-web-app-title"]')
      ?.getAttribute("content"),
    appleCapable: document
      .querySelector(
        'meta[name="mobile-web-app-capable"], meta[name="apple-mobile-web-app-capable"]',
      )
      ?.getAttribute("content"),
    appleIcons: [...document.querySelectorAll('link[rel="apple-touch-icon"]')].map((l) =>
      l.getAttribute("href"),
    ),
  }));

/** The manifest as Chromium parsed it (CDP `Page.getAppManifest`): URLs already resolved against the page. */
type ParsedManifest = {
  id?: string;
  startUrl?: string;
  scope?: string;
  display?: string;
  name?: string;
  icons?: Array<{ url: string; sizes?: string; type?: string }>;
};

/**
 * What Chromium would install from this page: the manifest it found, the app it makes of it, and why it could not.
 *
 * The app's identity (id, start page, scope, display, name, icons) is read from the manifest Chromium itself fetched
 * and parsed, `manifest` in `Page.getAppManifest`, with its URLs resolved the way the browser resolves them (an id
 * left out becomes the start page). `Page.getAppId` is not used: Chromium's headless shell, which CI runs, answers it
 * with nothing at all, while the full browser answers with the same id the parsed manifest carries. A manifest that is
 * missing, unreadable or without these fields fails the test: there is no fallback to the JSON as served.
 */
async function installable(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const answer = (await cdp.send("Page.getAppManifest")) as {
    url: string;
    errors: unknown[];
    manifest?: ParsedManifest;
  };
  const { installabilityErrors } = (await cdp.send("Page.getInstallabilityErrors")) as {
    installabilityErrors: Array<{ errorId: string }>;
  };
  await cdp.detach();
  const parsed = answer.manifest;
  const path = (url: string | undefined) => (url ? new URL(url).pathname : null);
  return {
    manifest: answer.url ? new URL(answer.url).pathname : null,
    manifestErrors: answer.errors,
    app: parsed
      ? {
          id: path(parsed.id),
          startUrl: path(parsed.startUrl),
          scope: path(parsed.scope),
          display: parsed.display ?? null,
          name: parsed.name ?? null,
          icons: (parsed.icons ?? []).map((i) => path(i.url)),
        }
      : null,
    // every Playwright context is an incognito profile, where nothing can be installed: that one says nothing about
    // the app; any other reason fails the test
    errors: installabilityErrors.map((e) => e.errorId).filter((id) => id !== "in-incognito"),
  };
}

/** The two apps as Chromium makes them from their manifests: one domain, two identities, two start pages. */
const CELLR_APP = {
  id: "/",
  startUrl: "/",
  scope: "/",
  display: "kStandalone",
  name: "CELLR",
  icons: ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"],
};
const ADMIN_APP = {
  id: "/admin",
  startUrl: "/admin",
  scope: "/",
  display: "kStandalone",
  name: "CELLR Admin",
  icons: [
    "/icons/admin/icon-192.png",
    "/icons/admin/icon-512.png",
    "/icons/admin/icon-maskable-512.png",
  ],
};

test.describe("the CELLR and CELLR Admin web apps", () => {
  test.skip(({ isMobile }) => !isMobile, "phone project (one run is enough)");

  test("both manifests are public, valid JSON, and say which app they are", async ({ request }) => {
    const app = await request.get("/manifest.webmanifest");
    const admin = await request.get("/admin.webmanifest", { maxRedirects: 0 });
    for (const res of [app, admin]) {
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("application/manifest+json");
    }
    const a = await app.json();
    const m = await admin.json();
    // the CELLR app as it was: it still opens /, under its own name and icons
    expect(a).toMatchObject({
      name: "CELLR",
      short_name: "CELLR",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    expect(a.id).toBeUndefined();
    // CELLR Admin: its own id, name, start page and icons
    expect(m).toMatchObject({
      id: "/admin",
      name: "CELLR Admin",
      short_name: "CELLR Admin",
      start_url: "/admin",
      scope: "/",
      display: "standalone",
    });
    const icons = m.icons as Array<{ src: string; sizes: string; purpose: string }>;
    expect(icons.map((i) => i.src).every((s) => s.startsWith("/icons/admin/"))).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
    for (const i of icons) {
      const img = await request.get(i.src);
      expect(img.status(), i.src).toBe(200);
      expect(img.headers()["content-type"], i.src).toContain("image/png");
    }
    // public, so nothing in it about the admin's data or who may use it
    const text = await admin.text();
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|@|CELLR_|SUPABASE|token|secret/i);
  });

  test("the CELLR app's pages keep its manifest, name and icon", async ({ browser }) => {
    const context = await browser.newContext(PHONE);
    const page = await context.newPage();
    await page.goto("/sign-in");
    expect(await head(page)).toMatchObject({
      manifests: ["/manifest.webmanifest"],
      appleTitle: "CELLR",
      appleIcons: ["/icons/apple-touch-icon.png"],
    });
    const app = await installable(page);
    expect(app).toMatchObject({ manifest: "/manifest.webmanifest", errors: [] });
    expect(app.manifestErrors).toEqual([]);
    expect(app.app).toEqual(CELLR_APP);
    // signed out, / is still the app's front door (sign-in), never the admin
    await page.goto("/");
    await expect(page).toHaveURL(/\/sign-in/);
    await context.close();
  });

  test("the admin pages install CELLR Admin: its own manifest, name, icon and app id", async ({
    browser,
  }) => {
    const { page, close } = await adminContext(browser, PHONE);
    for (const route of ["/admin", "/admin/wines", "/admin/system/health"]) {
      await page.goto(route);
      expect(await head(page), route).toMatchObject({
        manifests: ["/admin.webmanifest"],
        appleTitle: "CELLR Admin",
        appleIcons: ["/icons/admin/apple-touch-icon.png"],
      });
    }
    const admin = await installable(page);
    expect(admin).toMatchObject({ manifest: "/admin.webmanifest", errors: [] });
    expect(admin.manifestErrors).toEqual([]);
    expect(admin.app).toEqual(ADMIN_APP);
    // two apps on one domain: different identities and start pages, the same scope (sign-in stays in the window)
    expect(admin.app!.id).not.toBe(CELLR_APP.id);
    // the admin's own link to the CELLR app goes to the app, with the app's manifest again: two apps, two ids
    await page.getByTestId("admin-menu-button").tap();
    await page.getByRole("link", { name: "Open the CELLR app" }).tap();
    await page.waitForURL((u) => !u.pathname.startsWith("/admin"));
    await expect.poll(async () => (await head(page)).manifests).toEqual(["/manifest.webmanifest"]);
    const back = await installable(page);
    expect(back).toMatchObject({ manifest: "/manifest.webmanifest", errors: [] });
    expect(back.app).toEqual(CELLR_APP);
    await close();
  });

  test("in the admin app: navigate, sign out, sign in again and land back in the admin", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    // a session of its own: signing out must not end the one other tests share
    const { page, close } = await freshAdminContext(browser, PHONE);
    await page.goto("/admin");
    // the start page and a few pages through the app's own navigation (no address bar in the installed app)
    await page
      .getByTestId("admin-tab-bar")
      .getByRole("button", { name: /^System/ })
      .tap();
    await page.getByTestId("admin-nav-sheet").getByRole("link", { name: "Health" }).tap();
    await expect(page).toHaveURL(/\/admin\/system\/health$/);
    await page
      .getByTestId("admin-back")
      .or(page.getByRole("link", { name: "Overview" }))
      .first();
    await page.getByTestId("admin-tab-bar").getByRole("link", { name: "Overview" }).tap();
    await expect(page).toHaveURL(/\/admin$/);

    // sign out from the admin's own menu
    await page.getByTestId("admin-menu-button").tap();
    await page.getByTestId("admin-nav-sheet").getByTestId("admin-sign-out").tap();
    await page.waitForURL(/\/sign-in\?next=%2Fadmin$/);
    // the admin is closed now
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fadmin$/);
    await expect(page.getByTestId("admin-tab-bar")).toHaveCount(0);

    // sign in again, on that same page: back in the admin, where the app started
    await signInHere(page);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByTestId("admin-page-title")).toHaveText("Overview");
    await close();
  });

  test("the desktop sidebar can sign out too", async ({ browser }) => {
    const { page, close } = await adminContext(browser, { viewport: { width: 1440, height: 900 } });
    await page.goto("/admin");
    await expect(page.getByRole("complementary").getByTestId("admin-sign-out")).toBeVisible();
    await close();
  });
});
