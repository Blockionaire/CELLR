import { expect, test, type Browser, type Page } from "@playwright/test";
import { ADMIN_ID, adminContext, ensureAdmin } from "./admin-session";
import { arrive, audit, sql, stamp } from "./helpers";

/**
 * Mobile Admin Portal 2.0: the whole admin portal on a phone (390 px, and the 320 px minimum), with the desktop kept
 * as it was. Every page opens without sideways scrolling; the header and tab bar reach every page, mark where you
 * are and keep back, history and direct links right; lists are cards with their filters and sorting; a correction
 * and a photo review are done start to finish; the architecture is a list with details and a map that answers to
 * touch; health tells problems and unknowns apart. Its own data, under its own names: no other spec depends on it.
 * Screenshots land in test-results/shots/mobile-admin/ (local stack only: no real data, no credentials).
 */
const SHOTS = "test-results/shots/mobile-admin";

async function asAdmin(browser: Browser, width = 390, phone = true) {
  return adminContext(
    browser,
    phone
      ? { viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
      : { viewport: { width, height: 900 } },
  );
}

/**
 * A catalogue wine, a correction from a scan, and a bottle photo waiting for review: all under one fresh name.
 * The correction and the photo belong to the test admin, so the admin's auth user is made first: on a fresh
 * database nothing else has made it yet (signing in does that, and comes after the seed), and the foreign keys
 * from catalog_scan_signals and bottle_photo_submissions to auth.users would refuse the rows.
 */
async function seed() {
  await ensureAdmin();
  const m = stamp();
  const [p] = await sql<{ id: string }>(
    `insert into public.producers (name, country_code, status, origin)
     values ($1, 'FR', 'canonical', 'verified') returning id`,
    [`Domaine Mobile ${m}`],
  );
  const [w] = await sql<{ id: string }>(
    `insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
     values ($1, $2, 'red', 'FR', 'Bordeaux', 'canonical', 'verified') returning id`,
    [p!.id, `Cuvée Pouce ${m}`],
  );
  const [h] = await sql<{ id: string }>(
    "insert into public.households (name) values ($1) returning id",
    [`House ${m}`],
  );
  const [signal] = await sql<{ id: string }>(
    `insert into public.catalog_scan_signals
       (kind, wine_id, household_id, user_id, signal, changed_fields, proposed, confirmed, fingerprint, status, source)
     values ('catalog', $1, $2, $3, 'corrected', array['region'], $4::jsonb, $5::jsonb, $6, 'open', 'vision')
     returning id`,
    [
      w!.id,
      h!.id,
      ADMIN_ID,
      JSON.stringify({ region: "Bordeaux" }),
      JSON.stringify({ region: "Saint-Émilion" }),
      `fp-${m}`,
    ],
  );
  const [photo] = await sql<{ id: string }>(
    `insert into public.bottle_photo_submissions
       (user_id, producer_text, wine_text, wine_type, photo_path, width, height, consent_granted_at, status, source_wine_id)
     values ($1, $2, $3, 'red', $4, 900, 1600, now(), 'pending', $5) returning id`,
    [ADMIN_ID, `Domaine Mobile ${m}`, `Cuvée Pouce ${m}`, `${ADMIN_ID}/mobile-${m}.jpg`, w!.id],
  );
  return { m, wineId: w!.id, signalId: signal!.id, photoId: photo!.id };
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("the admin portal on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "phone project");

  for (const width of [390, 320])
    test(`every admin page opens at ${width} px without sideways scrolling`, async ({
      browser,
    }) => {
      test.setTimeout(180_000);
      const s = await seed();
      const routes = [
        "/admin",
        "/admin/wines",
        `/admin/wines/${s.wineId}`,
        "/admin/bottle-photos",
        `/admin/bottle-photos/${s.photoId}`,
        "/admin/catalog",
        "/admin/catalog/corrections",
        `/admin/catalog/corrections/${s.wineId}`,
        "/admin/sources",
        "/admin/users",
        `/admin/users/${ADMIN_ID}`,
        "/admin/product",
        "/admin/ai",
        "/admin/feedback",
        "/admin/system",
        "/admin/system/health",
      ];
      // a catalogue candidate exists only once households confirmed one; its page is checked when there is one
      const [candidate] = await sql<{ id: string }>(
        "select id from public.catalog_candidates order by created_at desc limit 1",
      );
      if (candidate) routes.push(`/admin/catalog/${candidate.id}`);
      {
        const { page, close } = await asAdmin(browser, width);
        for (const route of routes) {
          const res = await page.goto(route);
          expect(res?.status(), route).toBe(200);
          await expect(page.locator("main h1").first(), route).toBeVisible();
          await expect(page.getByTestId("admin-mobile-header"), route).toBeVisible();
          await expect(page.getByTestId("admin-tab-bar"), route).toBeVisible();
          expect(await overflow(page), `${route} at ${width} px`).toBeLessThanOrEqual(0);
          if (width === 390)
            await page.screenshot({
              path: `${SHOTS}/390${route.replace(/\/[0-9a-f-]{36}/g, "-detail").replaceAll("/", "_")}.png`,
              fullPage: true,
            });
        }
        await close();
      }
    });

  test("the header and tab bar reach every page, mark where you are, and keep back and links right", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const s = await seed();
    const { page, close } = await asAdmin(browser);
    const bar = page.getByTestId("admin-tab-bar");
    await page.goto("/admin");
    await expect(bar.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // the desktop sidebar is not there on a phone; the tab bar has four areas within thumb reach
    await expect(page.getByRole("navigation", { name: "Admin", exact: true })).toBeHidden();
    await expect(bar.locator("[data-tab]")).toHaveCount(4);
    for (const el of await bar.locator("[data-tab]").all()) {
      const box = (await el.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    // the tab bar sits above the home indicator area and never covers the page's last element
    const lastBottom = await page.evaluate(() => {
      const main = document.getElementById("admin-main")!;
      return getComputedStyle(main).paddingBottom;
    });
    expect(parseFloat(lastBottom)).toBeGreaterThanOrEqual(64);

    // an area with several pages opens a sheet of them; the chosen page becomes current
    await bar.getByRole("button", { name: /^Wine/ }).tap();
    const sheet = page.getByTestId("admin-nav-sheet");
    await expect(sheet.getByRole("link")).toHaveCount(5);
    await page.screenshot({ path: `${SHOTS}/nav-wine-sheet.png` });
    await sheet.getByRole("link", { name: "Corrections" }).tap();
    await expect(page).toHaveURL(/\/admin\/catalog\/corrections$/);
    await expect(page.getByTestId("admin-page-title")).toHaveText("Corrections");
    await expect(bar.getByRole("button", { name: /^Wine/ })).toHaveAttribute("data-active", "true");
    await expect(sheet).toBeHidden();

    // the menu lists every page of the portal, and returns focus to the menu button when closed
    await page.getByTestId("admin-menu-button").tap();
    await expect(sheet.getByRole("link")).toHaveCount(13);
    await expect(sheet.getByRole("link", { name: "Corrections" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.screenshot({ path: `${SHOTS}/nav-menu.png` });
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId("admin-menu-button")).toBeFocused();

    // every page of the navigation, through the menu
    const pages: Array<[string, RegExp]> = [
      ["Wine Master Database", /\/admin\/wines$/],
      ["Bottle photos", /\/admin\/bottle-photos$/],
      ["Wine catalogue", /\/admin\/catalog$/],
      ["External sources", /\/admin\/sources$/],
      ["Users", /\/admin\/users$/],
      ["Product analytics", /\/admin\/product$/],
      ["AI & costs", /\/admin\/ai$/],
      ["Beta feedback", /\/admin\/feedback$/],
      ["Architecture", /\/admin\/system$/],
      ["Health", /\/admin\/system\/health$/],
      ["Overview", /\/admin$/],
    ];
    for (const [label, url] of pages) {
      await page.getByTestId("admin-menu-button").tap();
      await sheet.getByRole("link", { name: label, exact: true }).tap();
      await expect(page).toHaveURL(url);
      await expect(page.getByTestId("admin-page-title")).toHaveText(label);
    }

    // a detail page: "back" goes to its list, a direct link works, the browser's history is kept
    await page.goto(`/admin/catalog/corrections/${s.wineId}`);
    await expect(page.getByTestId("admin-page-title")).toHaveText("Wine corrections");
    await expect(page.getByTestId("admin-back")).toHaveAttribute(
      "href",
      "/admin/catalog/corrections",
    );
    await page.getByTestId("admin-back").tap();
    await expect(page).toHaveURL(/\/admin\/catalog\/corrections$/);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/admin/catalog/corrections/${s.wineId}$`));
    await close();
  });

  test("Wine Master Database: search, a filter panel, sorting, and a card that opens the wine", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const s = await seed();
    const { page, close } = await asAdmin(browser);
    await page.goto("/admin/wines");
    // search stays usable with the keyboard open: 16 px text (no zoom) and a search key
    const search = page.getByRole("searchbox", { name: "Search wines" });
    expect(await search.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    await search.fill(`Pouce ${s.m}`);
    await search.press("Enter");
    await expect(page.getByTestId("master-row")).toHaveCount(1);
    const card = page.getByTestId("master-row");
    await expect(card).toContainText(`Cuvée Pouce ${s.m}`);
    // a card: the wine's name, then each value with its label
    await expect(card.locator('td[data-label="Type"]')).toContainText("Red");

    // the filters are folded away behind one button, and still part of the same search form
    const panel = page.getByTestId("wine-filters");
    const toggle = panel.getByRole("button", { name: /Filters/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel.getByLabel("Type")).toBeHidden();
    await toggle.tap();
    await expect(panel.getByLabel("Type")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/wines-filters-open.png` });
    await panel.getByLabel("Type").selectOption("white");
    await panel.getByRole("button", { name: "Apply filters" }).tap();
    await expect(page).toHaveURL(/type=white/);
    await expect(page.getByTestId("master-row")).toHaveCount(0);
    await page.getByRole("link", { name: "Remove filter: White" }).tap();
    await expect(page.getByTestId("master-row")).toHaveCount(1);

    // sorting lives in the table header on a desktop, and in a row of sort links on a phone
    await page
      .getByTestId("phone-sort")
      .getByRole("link", { name: /^Vintages/ })
      .tap();
    await expect(page).toHaveURL(/sort=vintages/);

    // the card opens the wine; back returns to the same search
    await page.getByTestId("master-row").getByRole("link").first().tap();
    await expect(page).toHaveURL(new RegExp(`/admin/wines/${s.wineId}`));
    await expect(page.getByTestId("admin-page-title")).toHaveText("Wine");
    await page.screenshot({ path: `${SHOTS}/wine-detail.png`, fullPage: true });
    await page.getByTestId("admin-back").tap();
    await expect(page).toHaveURL(/q=Pouce/);
    await close();
  });

  test("a correction is reviewed and saved, start to finish, on a phone", async ({ browser }) => {
    test.setTimeout(90_000);
    const s = await seed();
    const { page, close } = await asAdmin(browser);
    await page.goto("/admin/catalog/corrections");
    await page
      .getByRole("row")
      .filter({ hasText: `Cuvée Pouce ${s.m}` })
      .getByRole("link")
      .first()
      .tap();
    await expect(page).toHaveURL(new RegExp(`/admin/catalog/corrections/${s.wineId}`));
    const review = page.getByTestId("signal-review");
    await expect(review).toHaveCount(1);
    // what the scan proposed and what the person confirmed, field by field, both readable
    const row = page.getByRole("row").filter({ has: review });
    await expect(row.locator('td[data-label="Proposed"]')).toContainText("Region: Bordeaux");
    await expect(row.locator('td[data-label="Confirmed"]')).toContainText("Region: Saint-Émilion");
    await page.screenshot({ path: `${SHOTS}/correction-detail.png`, fullPage: true });
    await review.getByLabel("Internal note").fill("Checked on a phone");
    const reviewed = review.getByRole("button", { name: "Reviewed" });
    expect((await reviewed.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await reviewed.tap();
    await expect(page.getByTestId("action-message")).toContainText("Marked as reviewed.");
    expect(
      await sql("select status, admin_note from public.catalog_scan_signals where id = $1", [
        s.signalId,
      ]),
    ).toEqual([{ status: "reviewed", admin_note: "Checked on a phone" }]);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await close();
  });

  test("a bottle photo is reviewed on a phone, and an irreversible removal asks twice", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const s = await seed();
    const { page, close } = await asAdmin(browser);
    await page.goto("/admin/bottle-photos?stage=pending");
    await page
      .getByRole("row")
      .filter({ hasText: `Cuvée Pouce ${s.m}` })
      .getByRole("link", { name: new RegExp(s.m) })
      .first()
      .tap();
    await expect(page).toHaveURL(new RegExp(`/admin/bottle-photos/${s.photoId}`));
    await expect(page.getByTestId("admin-page-title")).toHaveText("Bottle photo");
    // the photo opens full size (to inspect it), and fits the screen here
    const photo = page.getByTestId("submission-photo").first();
    const box = (await photo.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(390);
    await expect(page.getByRole("link", { name: /opens the full photo/ }).first()).toHaveAttribute(
      "href",
      new RegExp(`/admin/bottle-photos/${s.photoId}/photo`),
    );
    await page.getByLabel("Note (internal)").fill("Sharp, upright");
    await page.getByRole("button", { name: "Approve" }).tap();
    await expect(page.getByTestId("action-message")).toContainText("Marked as approved.");
    expect(
      await sql("select status from public.bottle_photo_submissions where id = $1", [s.photoId]),
    ).toEqual([{ status: "approved" }]);
    await close();
  });

  test("Architecture: a list of components, details in a sheet, and a map that answers to touch", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const { page, close } = await asAdmin(browser);
    await page.goto("/admin/system");
    const list = page.getByTestId("component-list");
    await expect(list).toBeVisible();
    await expect(page.getByTestId("system-map")).toBeHidden();
    // every component is listed, grouped by layer, with its status and connections
    const total = Number(await page.locator("dt:text-is('Components') + dd").first().innerText());
    await expect(list.locator("[data-component-row]")).toHaveCount(total);
    const scans = list.locator('[data-component-row="svc-scans"]');
    await expect(scans).toContainText("Scan recognition");
    await expect(scans).toContainText(/Uses \d+ · used by \d+/);
    await expect(scans).toContainText("Implemented");
    await page.screenshot({ path: `${SHOTS}/architecture-list.png` });

    // the search narrows the list
    await page.getByRole("searchbox", { name: /Search components/ }).fill("scan recognition");
    await expect(list.locator('[data-component-row="svc-scans"]')).toBeVisible();
    await expect.poll(() => list.locator("[data-component-row]").count()).toBeLessThan(total);
    await page.getByRole("searchbox", { name: /Search components/ }).fill("");

    // a component's details open in a sheet: what it does, its trace, risks, evidence
    await scans.tap();
    const sheet = page.getByTestId("component-sheet");
    await expect(sheet.getByRole("heading", { name: "Scan recognition" })).toBeVisible();
    await expect(page).toHaveURL(/#c=svc-scans/);
    await expect(sheet.getByText(/^Uses \(\d+\)$/)).toBeVisible();
    await sheet.getByRole("radio", { name: "Used by" }).tap();
    await expect(sheet.getByTestId("trace-summary")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/architecture-detail.png` });

    // from the details to the drawing: the map fills the screen, the component is selected
    await sheet.getByRole("button", { name: "Show on the map" }).tap();
    await expect(page).toHaveURL(/m=map/);
    const map = page.getByTestId("system-map");
    await expect(map).toBeVisible();
    await expect(page.locator('[data-node="svc-scans"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("map-selection")).toContainText("Scan recognition");
    // a touch pinch zooms the map, not the page; a drag pans it
    const zoom = map.locator("div").filter({ hasText: /^\d+%/ }).first();
    const before = await zoom.innerText();
    const b = (await map.boundingBox())!;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const pointer = (type: string, id: number, x: number, y: number) =>
      map.dispatchEvent(type, {
        pointerId: id,
        pointerType: "touch",
        isPrimary: id === 1,
        clientX: x,
        clientY: y,
        button: 0,
        bubbles: true,
      });
    await pointer("pointerdown", 1, cx - 20, cy);
    await pointer("pointerdown", 2, cx + 20, cy);
    for (let d = 30; d <= 120; d += 30) {
      await pointer("pointermove", 1, cx - d, cy);
      await pointer("pointermove", 2, cx + d, cy);
    }
    await pointer("pointerup", 1, cx - 120, cy);
    await pointer("pointerup", 2, cx + 120, cy);
    await expect(zoom).not.toHaveText(before);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
    // fit the whole map, from a 44 px button
    const fitAll = map.getByRole("button", { name: "Fit the whole map" });
    expect((await fitAll.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await fitAll.tap();
    await page.screenshot({ path: `${SHOTS}/architecture-map.png` });
    // the selection's card opens the same details
    await page.getByTestId("map-selection").getByRole("button", { name: "Details" }).tap();
    await expect(sheet.getByRole("heading", { name: "Scan recognition" })).toBeVisible();
    await page.keyboard.press("Escape");
    // back to the list
    await page.getByTestId("phone-mode").getByRole("button", { name: "List" }).tap();
    await expect(list).toBeVisible();
    await expect(page).not.toHaveURL(/m=map/);

    // a deep link to a component opens its details on a phone
    await page.goto("/admin/system#c=ai-gateway");
    await expect(sheet.getByRole("heading", { name: "AI gateway" })).toBeVisible();
    await page.keyboard.press("Escape");
    // the other views are cards, not wide tables
    await page.getByRole("tab", { name: "Register" }).tap();
    await expect(page.getByTestId("register-table")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page
      .getByTestId("register-table")
      .getByRole("button", { name: "AI sommelier", exact: true })
      .tap();
    await expect(sheet.getByRole("heading", { name: "AI sommelier" })).toBeVisible();
    await close();
  });

  test("Health: a compact summary, problems first, and unknown never shown as healthy", async ({
    browser,
  }) => {
    const { page, close } = await asAdmin(browser);
    await page.goto("/admin/system/health");
    const head = page.getByTestId("health-headline");
    const unavailable = page.getByTestId("health-unavailable");
    await expect(head.or(unavailable)).toBeVisible();
    if (await unavailable.isVisible()) {
      // health not readable here: the page says why and the rest of the admin is unaffected
      await close();
      return;
    }
    await expect(page.getByTestId("measure-now")).toBeVisible();
    expect((await page.getByTestId("measure-now").boundingBox())!.height).toBeGreaterThanOrEqual(
      44,
    );
    const probes = page.locator("[data-probe]");
    const all = await probes.count();
    expect(all).toBeGreaterThan(5);
    // the counts add up to the checks, and the headline is never healthy while any check is unknown
    const counts = await page
      .locator("[data-count] dd")
      .allInnerTexts()
      .then((xs) => xs.map(Number));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(all);
    const unknown = await page.locator('[data-probe][data-status="unknown"]').count();
    if (unknown > 0) await expect(head).not.toHaveAttribute("data-status", "healthy");
    // every check states its status in words, and says when there is no measurement
    for (const p of await probes.all())
      await expect(p).toContainText(/Healthy|Degraded|Failed|Unknown/);
    await page.screenshot({ path: `${SHOTS}/health.png`, fullPage: true });

    // the filters: only unknown checks; only problems (or the reason there are none)
    const filter = page.getByTestId("health-filter");
    await filter.getByRole("link", { name: /^Unknown/ }).tap();
    await expect(page).toHaveURL(/show=unknown/);
    await expect(page.locator('[data-probe]:not([data-status="unknown"])')).toHaveCount(0);
    await filter.getByRole("link", { name: /^Problems/ }).tap();
    await expect(page.locator('[data-probe][data-status="healthy"]')).toHaveCount(0);
    await expect(page.locator('[data-probe][data-status="unknown"]')).toHaveCount(0);
    if ((await probes.count()) === 0)
      await expect(page.getByTestId("health-filter-empty")).toBeVisible();
    // a check's technical details unfold
    await filter.getByRole("link", { name: /^All/ }).tap();
    const first = probes.first();
    await first.locator("summary").tap();
    await expect(first.getByText("Does not prove:")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/health-detail.png` });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await close();
  });

  test("the overview says whether CELLR works and offers the daily actions", async ({
    browser,
  }) => {
    const { page, close } = await asAdmin(browser);
    await page.goto("/admin");
    const status = page.getByTestId("overview-status");
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute("href", "/admin/system/health");
    // the status is a measured one or unknown, and unknown is said in words
    const st = await status.getAttribute("data-status");
    expect(["healthy", "degraded", "failed", "unknown"]).toContain(st);
    if (st === "unknown") await expect(status).toContainText(/Unknown|unknown/);
    const actions = page.getByTestId("quick-actions").getByRole("link");
    await expect(actions).toHaveCount(8);
    for (const name of [
      "Wine Master Database",
      "Corrections",
      "Community reviews",
      "Health",
      "Architecture",
    ])
      await expect(page.getByTestId("quick-actions").getByRole("link", { name })).toBeVisible();
    await expect(page.getByTestId("work-queue")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/overview.png`, fullPage: true });
    // the admin's pages are never stored by the browser or the service worker
    const res = await page.request.get("/admin");
    expect(res.headers()["cache-control"]).toContain("no-store");
    await close();
  });

  test("the phone pages pass the accessibility checks", async ({ browser }) => {
    test.setTimeout(120_000);
    const { page, close } = await asAdmin(browser);
    for (const route of [
      "/admin",
      "/admin/wines",
      "/admin/catalog/corrections",
      "/admin/users",
      "/admin/system",
      "/admin/system/health",
    ]) {
      await page.goto(route);
      await expect(page.locator("main h1").first()).toBeVisible();
      expect(await audit(page), route).toEqual([]);
    }
    // with a sheet open, too
    await page.getByTestId("admin-menu-button").tap();
    await expect(page.getByTestId("admin-nav-sheet")).toBeVisible();
    expect(await audit(page), "menu").toEqual([]);
    await close();
  });

  test("someone who is not an admin gets neither the navigation nor the pages", async ({
    page,
    browser,
  }) => {
    await arrive(page, "notmobileadmin");
    const res = await page.goto("/admin/wines");
    expect(res?.status()).toBe(404);
    await expect(page.getByTestId("admin-tab-bar")).toHaveCount(0);
    await expect(page.getByTestId("admin-mobile-header")).toHaveCount(0);
    expect(await page.content()).not.toContain("Wine Master Database");
    // signed out: to sign-in, nothing of the admin
    const context = await browser.newContext({
      isMobile: true,
      viewport: { width: 390, height: 844 },
    });
    const out = await context.newPage();
    await out.goto("/admin");
    await expect(out).toHaveURL(/\/sign-in/);
    await expect(out.getByTestId("admin-tab-bar")).toHaveCount(0);
    await context.close();
  });
});

test.describe("the admin portal on a desktop", () => {
  test.skip(({ isMobile }) => isMobile, "desktop project");

  test("keeps its sidebar, tables and map with panel; no phone navigation", async ({ browser }) => {
    test.setTimeout(90_000);
    const { page, close } = await asAdmin(browser, 1440, false);
    await page.goto("/admin/wines");
    const side = page.getByRole("navigation", { name: "Admin", exact: true });
    await expect(side).toBeVisible();
    await expect(side.getByRole("link", { name: "Wine Master Database" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("admin-tab-bar")).toBeHidden();
    await expect(page.getByTestId("admin-mobile-header")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
    // a real table: its column headers show, sortable; the phone's sort row does not
    await expect(page.getByRole("columnheader", { name: /Wine/ }).first()).toBeVisible();
    await expect(page.getByTestId("phone-sort")).toBeHidden();
    // filters are open, not folded
    await expect(page.getByTestId("wine-filters").getByLabel("Type")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/desktop-wines.png` });

    await page.goto("/admin/system");
    await expect(page.getByTestId("system-map")).toBeVisible();
    await expect(page.getByTestId("component-list")).toBeHidden();
    await expect(page.getByTestId("phone-mode")).toBeHidden();
    await page.locator('[data-node="svc-scans"]').click();
    await expect(
      page.getByTestId("system-detail").getByRole("heading", { name: "Scan recognition" }),
    ).toBeVisible();
    await expect(page.getByTestId("component-sheet")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/desktop-architecture.png` });
    await close();
  });
});
