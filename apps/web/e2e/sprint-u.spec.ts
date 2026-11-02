import path from "node:path";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { apiClient, arrive, audit, makeJpeg, sessionToken, sql, stamp, signIn } from "./helpers";

/**
 * Sprint U: the admin portal as a daily tool. Readable in both themes (axe colour contrast on the rendered pages),
 * whole-row links that work with the mouse and the keyboard, the Wine Master Database filtered, sorted and paged in the
 * database with its state in the URL, and the bottle-photo → 2D-artwork workflow walked end to end: pending → approved
 * → draft → published, from the contribution straight to the wine's artwork section, with its publication scope.
 * Screenshots of the key pages at a desktop and a narrower width land in test-results/sprint-u/.
 */
test.skip(({ isMobile }) => isMobile, "the admin portal is desktop-first: the desktop project");

const ADMIN_ID = "00000000-0000-4000-8000-00000000ad01";
const ADMIN_EMAIL = "feedback-admin@cellr.invalid";
const DESKTOP = { width: 1440, height: 900 };
const NARROW = { width: 820, height: 1000 };

async function asAdmin(browser: Browser, theme: "dark" | "light" = "dark", viewport = DESKTOP) {
  await sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
    ADMIN_ID,
    ADMIN_EMAIL,
  ]);
  const context = await browser.newContext({ viewport, colorScheme: theme });
  await context.addCookies([{ name: "theme", value: theme, url: "http://localhost:3100" }]);
  const admin = await context.newPage();
  await signIn(admin, ADMIN_EMAIL);
  return { admin, close: () => context.close() };
}

/** A screenshot for the report, and an attachment on the test. */
async function shot(page: Page, name: string) {
  const file = path.join(test.info().project.outputDir, "sprint-u", `${name}.png`);
  // from the top: a full-page capture of a scrolled page would draw the sticky bars mid-page
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: file, fullPage: true });
  await test.info().attach(name, { path: file, contentType: "image/png" });
}

/** No horizontal page scroll: a wide table scrolls inside its own frame. */
async function noPageOverflow(page: Page) {
  const { scroll, width, wide } = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")]
      .filter(
        (el) =>
          el.getBoundingClientRect().right > w + 1 &&
          !el.parentElement?.closest(".overflow-x-auto"),
      )
      .slice(0, 8)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}[${Math.round(el.getBoundingClientRect().right)}].${String(el.className).slice(0, 60)}`,
      );
    return { scroll: document.documentElement.scrollWidth, width: w, wide };
  });
  expect(scroll, `page scrolls sideways: ${wide.join(" | ")}`).toBeLessThanOrEqual(width + 1);
}

/** Colour contrast and the rest of WCAG 2.1 AA, on what is rendered right now. */
async function readable(page: Page) {
  expect(await audit(page)).toEqual([]);
}

/** A text link uses the design system's link colour (accent-fg), never the on-accent text colour. */
async function linkColoured(link: Locator) {
  const [color, fg, onAccent] = await link.evaluate((el) => {
    const probe = (v: string) => {
      const s = document.createElement("span");
      s.style.color = `var(${v})`;
      document.body.append(s);
      const c = getComputedStyle(s).color;
      s.remove();
      return c;
    };
    return [getComputedStyle(el).color, probe("--accent-fg"), probe("--accent-ink")];
  });
  expect(color).toBe(fg);
  expect(color).not.toBe(onAccent);
}

/** A finished 2D bottle picture, drawn in the browser. */
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

/** 55 catalogue wines of one producer: every third white, the even ones Italian, a few with vintages. */
async function catalogue(producer: string) {
  const [p] = await sql<{ id: string }>(
    `insert into public.producers (name, country_code, status, origin)
     values ($1, 'FR', 'canonical', 'verified') returning id`,
    [producer],
  );
  await sql(
    `insert into public.wines (producer_id, name, wine_type, country_code, status, origin)
     select $1, 'Cuvée ' || lpad(g::text, 2, '0'),
            (case when g % 3 = 0 then 'white' else 'red' end)::public.wine_type,
            case when g % 2 = 0 then 'IT' else 'FR' end, 'canonical', 'verified'
       from generate_series(1, 55) g`,
    [p!.id],
  );
  // Cuvée 07: three vintages, Cuvée 12: two, Cuvée 20: one
  await sql(
    `insert into public.wine_vintages (wine_id, year)
     select w.id, y from public.wines w cross join lateral generate_series(2001, 2000 +
       case w.name when 'Cuvée 07' then 3 when 'Cuvée 12' then 2 else 1 end) y
      where w.producer_id = $1 and w.name in ('Cuvée 07', 'Cuvée 12', 'Cuvée 20')`,
    [p!.id],
  );
  return p!.id;
}

const rowNames = async (page: Page) =>
  (await page.getByTestId("master-row").locator("a[data-row-link]").allTextContents()).map((t) =>
    t.trim(),
  );

test("the master list: readable, filtered, sorted and paged in the database, rows open the wine", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const producer = `Sprint U ${stamp()}`;
  await catalogue(producer);
  const { admin, close } = await asAdmin(browser);
  // the query string as the list writes it (URLSearchParams: a space is "+")
  const q = new URLSearchParams({ q: producer }).toString().slice(2).replace(/\+/g, "\\+");

  // ---- the sidebar: grouped, the current page marked -------------------------------------------------------------
  await admin.goto(`/admin/wines?q=${encodeURIComponent(producer)}`);
  const nav = admin.getByRole("navigation", { name: "Admin" });
  await expect(nav.getByText("Wine management")).toBeVisible();
  await expect(nav.getByRole("link", { name: "Wine Master Database" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");

  // ---- paging in the database: two pages, every wine exactly once -----------------------------------------------
  await expect(admin.getByTestId("master-total")).toContainText("55 wines");
  await expect(admin.getByTestId("master-total")).toContainText("page 1 of 2");
  const first = await rowNames(admin);
  expect(first).toHaveLength(50);
  expect(first[0]).toBe(`${producer} — Cuvée 01`);
  await readable(admin);
  await linkColoured(admin.getByRole("link", { name: "Clear filters" }));
  await shot(admin, "wines-desktop-dark");
  await admin
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: "Next →" })
    .click();
  await expect(admin).toHaveURL(new RegExp(`\\?q=${q}&page=2$`));
  const second = await rowNames(admin);
  expect(second).toHaveLength(5);
  expect(new Set([...first, ...second]).size).toBe(55);
  await admin.goBack();
  await expect(admin.getByTestId("master-total")).toContainText("page 1 of 2");

  // ---- sorting: a header link, marked with aria-sort, kept in the URL -------------------------------------------
  const table = admin.getByRole("table", { name: "Wines" });
  await table.getByRole("link", { name: /^Vintages/ }).click();
  await expect(admin).toHaveURL(/sort=vintages&dir=desc/);
  await expect(table.getByRole("columnheader", { name: /Vintages/ })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  expect((await rowNames(admin)).slice(0, 3)).toEqual(
    ["Cuvée 07", "Cuvée 12", "Cuvée 20"].map((n) => `${producer} — ${n}`),
  );
  await table.getByRole("link", { name: /^Vintages/ }).click();
  await expect(admin).toHaveURL(/sort=vintages(?!&dir)/);
  await expect(table.getByRole("columnheader", { name: /Vintages/ })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );
  await table.getByRole("link", { name: /^Vintages/ }).click();
  await expect(admin).toHaveURL(/sort=vintages&dir=desc$/);

  // ---- a whole row opens the wine: a click anywhere in it, and back keeps the list as it was ---------------------
  const listUrl = admin.url();
  const top = admin.getByTestId("master-row").first();
  await top.hover();
  await expect(top).toHaveCSS("cursor", "pointer");
  // a real click in the Type cell, not on the link text: the row's one link is stretched over the whole row
  const cell = (await top.locator("td").nth(1).boundingBox())!;
  await admin.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2);
  await expect(admin).toHaveURL(/\/admin\/wines\/[0-9a-f-]{36}\?back=/);
  await expect(admin.getByRole("heading", { level: 1 })).toHaveText(`${producer} — Cuvée 07`);
  const crumb = admin
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "Wine Master Database" });
  await linkColoured(crumb);
  await crumb.click();
  await expect(admin).toHaveURL(listUrl);
  await expect((await rowNames(admin))[0]).toBe(`${producer} — Cuvée 07`);

  // ---- ...and the keyboard: Tab reaches the row's one link, the focus is visible, Enter opens it -------------------
  await admin.getByLabel("Search wines").focus();
  let onRow = false;
  for (let i = 0; i < 40 && !onRow; i++) {
    await admin.keyboard.press("Tab");
    onRow = await admin.evaluate(
      () => document.activeElement?.hasAttribute("data-row-link") ?? false,
    );
  }
  expect(onRow, "Tab reaches a row").toBe(true);
  const ring = await admin.evaluate(() => {
    const el = document.activeElement!;
    const after = getComputedStyle(el, "::after");
    return {
      style: after.outlineStyle,
      width: after.outlineWidth,
      matches: el.matches(":focus-visible"),
    };
  });
  expect(ring).toEqual({ style: "solid", width: "2px", matches: true });
  await admin.keyboard.press("Enter");
  await expect(admin).toHaveURL(/\/admin\/wines\/[0-9a-f-]{36}/);
  await admin.goBack();

  // ---- filters next to the table: in the URL in one form, shown as chips, each removable, and cleared ----------------
  await admin.getByLabel("Type").selectOption("white");
  await admin.getByLabel("Country").selectOption("IT");
  await admin.getByRole("button", { name: "Apply filters" }).click();
  await expect(admin).toHaveURL(
    new RegExp(`\\?q=${q}&type=white&country=IT&sort=vintages&dir=desc$`),
  );
  await expect(admin.getByTestId("master-total")).toContainText("9 wines");
  const chips = admin.getByRole("list", { name: "Active filters" });
  await expect(chips.getByRole("link")).toHaveText([/Sprint U/, /White/, /Country: IT/]);
  await chips.getByRole("link", { name: "Remove filter: White" }).click();
  await expect(admin.getByTestId("master-total")).toContainText("27 wines");
  await expect(admin).not.toHaveURL(/type=/);
  await admin.getByRole("link", { name: "Clear filters" }).first().click();
  await expect(admin).toHaveURL(/\/admin\/wines$/);

  // ---- older links still work: sent to the same list in the new form -------------------------------------------
  await admin.goto(`/admin/wines?scope=all&f=no_art,pending&q=${encodeURIComponent(producer)}`);
  await expect(admin).toHaveURL(new RegExp(`\\?q=${q}&art=missing&pending=1$`));
  await admin.goto(`/admin/wines?scope=all&filter=published&q=${encodeURIComponent(producer)}`);
  await expect(admin).toHaveURL(new RegExp(`\\?q=${q}&art=published$`));
  await expect(admin.getByText("No wines here.")).toBeVisible();
  await expect(admin.getByRole("link", { name: "Clear filters" })).toHaveCount(2);

  // ---- light theme and a narrower window: readable, nothing scrolls sideways but the table ------------------------
  await close();
  const light = await asAdmin(browser, "light", NARROW);
  await light.admin.goto(`/admin/wines?q=${encodeURIComponent(producer)}`);
  await expect(light.admin.getByTestId("master-row")).toHaveCount(50);
  await readable(light.admin);
  await noPageOverflow(light.admin);
  await shot(light.admin, "wines-narrow-light");
  await light.close();
});

test("a bottle photo to published 2D artwork: pending → approved → draft → published, scope and permissions", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const { email, household, householdId } = await arrive(page, "sprintu");
  const { call } = await apiClient(request, email);
  const name = `Cuvée Atelier ${stamp()}`;
  const wine = (
    await call<{ id: string }>(
      "post",
      "/wines",
      { producer: "Maison Atelier", name, type: "red", countryCode: "FR" },
      201,
    )
  ).body;
  await call(
    "post",
    "/bottles",
    { wineId: wine.id, year: 2020, quantity: 1, locationId: null },
    201,
  );
  const [v] = await sql<{ id: string }>("select id from public.wine_vintages where wine_id = $1", [
    wine.id,
  ]);
  const sent = await request.post("/api/v1/bottle-photos", {
    headers: { authorization: `Bearer ${await sessionToken(email)}` },
    multipart: {
      vintageId: v!.id,
      consent: "true",
      photo: {
        name: "IMG_1.jpg",
        mimeType: "image/jpeg",
        buffer: await makeJpeg(page, { width: 900, height: 1600, words: "Atelier" }),
      },
    },
  });
  expect(sent.ok()).toBe(true);
  const [sub] = await sql<{ id: string }>(
    "select id from public.bottle_photo_submissions where source_wine_id = $1",
    [wine.id],
  );
  const sid = sub!.id;

  // ---- the admin portal stays closed to everyone else ---------------------------------------------------------------
  for (const url of [
    "/admin",
    "/admin/bottle-photos?stage=pending",
    `/admin/bottle-photos/${sid}`,
    `/admin/wines?q=${encodeURIComponent(name)}`,
    `/admin/wines/${wine.id}`,
  ]) {
    // the not-found page (main answers it with a 200 today: a soft 404, see the PR), and nothing of the data
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "We couldn't find that page." })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(name);
    await expect(page.locator("body")).not.toContainText("Wine Master Database");
  }
  expect((await page.request.get(`/admin/bottle-photos/${sid}/photo`)).status()).toBe(404);

  const { admin, close } = await asAdmin(browser);

  // ---- the work queue leads to the photos waiting -----------------------------------------------------------------
  await admin.goto("/admin");
  const queue = admin.getByTestId("work-queue");
  await expect(queue.getByRole("link")).toHaveCount(5);
  await readable(admin);
  await shot(admin, "overview-desktop-dark");
  await queue.getByRole("link", { name: /Bottle photos awaiting review/ }).click();
  await expect(admin).toHaveURL(/\/admin\/bottle-photos\?stage=pending$/);
  await expect(
    admin.getByRole("navigation", { name: "Stage" }).getByRole("link", { name: /Pending review/ }),
  ).toHaveAttribute("aria-current", "page");
  await admin.getByLabel("Search photos").fill(name);
  await admin.getByRole("button", { name: "Search" }).click();
  const row = admin.getByTestId("photo-row").filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(`Household: ${household}`);
  await expect(row).toContainText("Pending review");
  await readable(admin);
  await shot(admin, "bottle-photos-desktop-dark");
  const vintageCell = (await row.locator("td").nth(2).boundingBox())!; // the whole row opens the photo
  await admin.mouse.click(
    vintageCell.x + vintageCell.width / 2,
    vintageCell.y + vintageCell.height / 2,
  );

  // ---- pending: review it ----------------------------------------------------------------------------------------
  await expect(admin).toHaveURL(new RegExp(`/admin/bottle-photos/${sid}\\?back=`));
  await expect(admin.getByTestId("workflow")).toHaveAttribute("data-stage", "pending");
  await expect(admin.getByTestId("next-step")).toContainText("review this photo");
  await expect(
    admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Bottle photos" }),
  ).toHaveAttribute("aria-current", "page");
  await admin.getByRole("button", { name: "Approve" }).click();

  // ---- approved: artwork needed, one prominent way to the wine's artwork section ----------------------------------
  await expect(admin.getByTestId("action-message")).toContainText("Marked as approved.");
  await expect(admin.getByTestId("workflow")).toHaveAttribute("data-stage", "artwork_needed");
  const scope = admin.getByTestId("publication-scope");
  await expect(scope).toHaveAttribute("data-scope", "household");
  await expect(scope).toContainText(`visible only to ${household}`);
  await expect(scope).toContainText("cannot be reused");
  await expect(scope.getByRole("link", { name: "Catalogue links →" })).toHaveAttribute(
    "href",
    `/admin/wines/${wine.id}#links`,
  );
  await readable(admin);
  await shot(admin, "bottle-photo-approved-desktop-dark");
  const cta = admin.getByRole("link", { name: "Create / Upload 2D Artwork →" });
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(admin).toHaveURL(`/admin/wines/${wine.id}?from=${sid}#art`);
  const art = admin.getByRole("region", { name: "2D Bottle Artwork" });
  await expect(art).toBeInViewport();
  await expect(art.getByTestId("from-contribution")).toBeVisible();
  await expect(art.getByTestId("art-scope")).toHaveAttribute("data-scope", "household");
  await expect(art.getByTestId("art-scope")).toContainText("cannot be reused for other households");
  const reference = art.getByTestId("art-references").locator("img");
  await expect(reference).toHaveCount(1);
  await expect
    .poll(() => reference.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth))
    .toBeGreaterThan(0);

  // ---- upload: a draft, previewed, the scope said again by the publish button -------------------------------------
  await art.locator('input[name="picture"]').setInputFiles(await bottlePng(admin));
  await art.getByRole("button", { name: "Upload as draft" }).click();
  await expect(admin).toHaveURL(new RegExp(`at=art&from=${sid}#art$`));
  await expect(art.getByTestId("action-message")).toContainText("Uploaded as a draft");
  await expect(art.getByTestId("draft-art")).toBeVisible();
  await expect(art).toBeInViewport();
  const publish = art.getByRole("button", { name: "Publish for this household only" });
  await expect(publish).toBeVisible();
  await readable(admin);
  await shot(admin, "wine-artwork-draft-desktop-dark");

  // the contribution now says a draft waits
  await admin.goto(`/admin/bottle-photos/${sid}`);
  await expect(admin.getByTestId("workflow")).toHaveAttribute("data-stage", "draft");
  await admin.getByRole("link", { name: "Review & publish 2D Artwork →" }).click();
  await expect(admin).toHaveURL(`/admin/wines/${wine.id}?from=${sid}#art`);

  // ---- publish: a success state, the contribution used, and the way back --------------------------------------------
  await art.getByRole("button", { name: "Publish for this household only" }).click();
  const success = art.getByTestId("publish-success");
  await expect(success).toBeVisible();
  await expect(success).toContainText(`for ${household} (and no one else)`);
  await expect(art.getByTestId("published-art")).toBeVisible();
  expect(
    await sql<{ status: string; art: boolean }>(
      "select status, art_id is not null as art from public.bottle_photo_submissions where id = $1",
      [sid],
    ),
  ).toEqual([{ status: "used", art: true }]);
  expect(
    await sql<{ n: number }>(
      "select count(*)::int as n from public.wine_bottle_art where wine_id = $1 and published_at is not null",
      [wine.id],
    ),
  ).toEqual([{ n: 1 }]);
  // nothing was linked, promoted or shared by it
  expect(
    await sql("select 1 from public.wine_links where source_wine_id = $1", [wine.id]),
  ).toHaveLength(0);
  expect(
    await sql<{ status: string }>("select status from public.wines where id = $1", [wine.id]),
  ).toEqual([{ status: "provisional" }]);
  await shot(admin, "wine-artwork-published-desktop-dark");
  await success.getByRole("link", { name: "← Back to the contribution" }).click();
  await expect(admin.getByTestId("workflow")).toHaveAttribute("data-stage", "published");
  await expect(admin.getByTestId("next-step")).toContainText("Artwork published");

  // ---- the stage follows the artwork as it is now, not the review history ----------------------------------------
  const reviewed = async () =>
    (
      await sql<{ status: string; art: string | null }>(
        "select status, art_id as art from public.bottle_photo_submissions where id = $1",
        [sid],
      )
    )[0]!;
  const firstArt = (await reviewed()).art!;
  // publish → take it off: a draft again, the contribution still "used", and it can be published again from it
  await admin.goto(`/admin/wines/${wine.id}?from=${sid}#art`);
  await art.getByRole("button", { name: /Take it off/ }).click();
  await expect(art.getByTestId("action-message")).toContainText("Taken off");
  await admin.goto(`/admin/bottle-photos/${sid}`);
  await expect(admin.getByTestId("workflow")).toHaveAttribute("data-stage", "draft");
  await expect(admin.getByTestId("used-unpublished")).toContainText("no longer published");
  expect(await reviewed()).toEqual({ status: "used", art: firstArt });
  await admin.getByRole("link", { name: "Review & publish 2D Artwork →" }).click();
  const source = art.getByRole("checkbox", { name: /this picture was made from it/ });
  await expect(source).toBeChecked();
  await art.getByRole("button", { name: "Publish for this household only" }).click();
  await expect(art.getByTestId("publish-success")).toBeVisible();
  expect(await reviewed()).toEqual({ status: "used", art: firstArt });
  // publish → remove: artwork needed again; a new picture is published from the same, original contribution
  await art.getByTestId("art-published").getByRole("button", { name: "Remove picture" }).click();
  await expect(art.getByTestId("action-message")).toContainText("Picture removed.");
  await admin.goto(`/admin/bottle-photos/${sid}`);
  await expect(admin.getByTestId("workflow")).toHaveAttribute("data-stage", "artwork_needed");
  await expect(admin.getByTestId("used-unpublished")).toBeVisible();
  expect(await reviewed()).toEqual({ status: "used", art: null });
  await admin.getByRole("link", { name: "Create / Upload 2D Artwork →" }).click();
  await art.locator('input[name="picture"]').setInputFiles(await bottlePng(admin));
  await art.getByRole("button", { name: "Upload as draft" }).click();
  // the contribution the admin came from is ticked as the source; the database checks it again
  await expect(art.getByRole("checkbox", { name: /Used/ })).toBeChecked();
  await art.getByRole("button", { name: "Publish for this household only" }).click();
  await expect(art.getByTestId("publish-success")).toBeVisible();
  const again = await reviewed();
  expect(again.status).toBe("used");
  expect(again.art).not.toBe(firstArt);
  await admin.goto(`/admin/bottle-photos/${sid}`);
  await expect(admin.getByTestId("workflow")).toHaveAttribute("data-stage", "published");
  await expect(admin.getByTestId("used-unpublished")).toHaveCount(0);

  // ---- the household's own wine in the master list: its household is a filter of its own -----------------------------
  await admin.goto(`/admin/wines?scope=household&q=${encodeURIComponent(name)}`);
  const own = admin.getByTestId("master-row").filter({ hasText: name });
  await expect(own).toContainText(`Household: ${household}`);
  await expect(own).toContainText("Published");
  await own.getByRole("link", { name: household }).click();
  await expect(admin).toHaveURL(new RegExp(`household=${householdId}`));
  await expect(admin.getByRole("list", { name: "Active filters" })).toContainText(
    `Household: ${household}`,
  );

  // ---- a narrower window: the photo page and the artwork section stay usable -----------------------------------------
  await close();
  const narrow = await asAdmin(browser, "light", NARROW);
  await narrow.admin.goto(`/admin/bottle-photos/${sid}`);
  await expect(narrow.admin.getByTestId("workflow")).toBeVisible();
  await noPageOverflow(narrow.admin);
  await readable(narrow.admin);
  await shot(narrow.admin, "bottle-photo-published-narrow-light");
  await narrow.admin.goto(`/admin/wines/${wine.id}#art`);
  await noPageOverflow(narrow.admin);
  await readable(narrow.admin);
  await shot(narrow.admin, "wine-artwork-narrow-light");
  await narrow.close();
});

test("a catalogue wine: shared scope, in-section save confirmations and validation errors", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const m = stamp();
  const [p] = await sql<{ id: string }>(
    `insert into public.producers (name, country_code, status, origin)
     values ($1, 'FR', 'canonical', 'verified') returning id`,
    [`Château Partagé ${m}`],
  );
  const [w] = await sql<{ id: string }>(
    `insert into public.wines (producer_id, name, wine_type, country_code, region, status, origin)
     values ($1, 'Grand Vin', 'red', 'FR', 'Bordeaux', 'canonical', 'verified') returning id`,
    [p!.id],
  );
  const { admin, close } = await asAdmin(browser);
  await admin.goto(`/admin/wines/${w!.id}`);
  await expect(admin.getByTestId("scope").first()).toHaveAttribute("data-scope", "catalogue");
  await expect(admin.getByTestId("scope").first()).toContainText("Shared change");
  await expect(admin.getByRole("region", { name: "Overview" })).toContainText("Read-only");
  await expect(admin.getByRole("region", { name: "Wine details" })).toContainText("Editable");

  // the section navigation reaches the artwork; a catalogue wine's artwork is shared
  await admin
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: /2D Bottle Artwork/ })
    .click();
  const art = admin.getByRole("region", { name: "2D Bottle Artwork" });
  await expect(art).toBeInViewport();
  await expect(art.getByTestId("art-scope")).toHaveAttribute("data-scope", "catalogue");
  await expect(art.getByTestId("art-scope")).toContainText("shared with every eligible household");
  await art.locator('input[name="picture"]').setInputFiles(await bottlePng(admin));
  await art.getByRole("button", { name: "Upload as draft" }).click();
  await expect(art.getByRole("button", { name: "Publish for everyone" })).toBeVisible();
  await expect(art.getByRole("button", { name: "Remove draft" })).toHaveCSS(
    "color",
    await admin.evaluate(() => {
      const s = document.createElement("span");
      s.style.color = "var(--danger)";
      document.body.append(s);
      return getComputedStyle(s).color;
    }),
  );

  // a save is confirmed where it was made; a refused one says why, as an alert, and changes nothing
  const details = admin.getByRole("region", { name: "Wine details" });
  const form = admin.getByTestId("wine-details");
  await form.getByLabel("Region").fill("Pauillac");
  await form.getByLabel("Reason (internal, optional)").fill("the label says so");
  await form.getByRole("button", { name: "Save wine details" }).click();
  await expect(admin).toHaveURL(/at=details#details$/);
  await expect(details.getByTestId("action-message")).toHaveAttribute("data-tone", "ok");
  await expect(details.getByTestId("action-message")).toContainText("Wine details saved.");
  await expect(details).toBeInViewport();
  await form.getByLabel("Bottle style (JSON, optional)").fill("{ not json");
  await form.getByRole("button", { name: "Save wine details" }).click();
  await expect(details.getByRole("alert")).toContainText("Not saved: a value is not valid.");
  expect(await sql("select region from public.wines where id = $1", [w!.id])).toEqual([
    { region: "Pauillac" },
  ]);
  await readable(admin);
  await shot(admin, "wine-details-desktop-dark");
  await close();
});
