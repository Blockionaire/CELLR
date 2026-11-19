import { expect, test, type Browser, type Page } from "@playwright/test";
import { arrive, audit, signIn, sql } from "./helpers";

/**
 * System Intelligence sprint 1: /admin/system, the Architecture Control Center. Closed (a real 404, nothing of the
 * register in the answer) for anyone who is not an admin; for an admin the map renders every component of the
 * register, tracing, impact, path finding, search, filters, the other views and deep links work, it fetches nothing
 * after the page loads (so it does not depend on any other system), and it is usable on a phone.
 */
const ADMIN_ID = "00000000-0000-4000-8000-00000000ad01";
const ADMIN_EMAIL = "feedback-admin@cellr.invalid";

async function asAdmin(browser: Browser, phone: boolean) {
  await sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
    ADMIN_ID,
    ADMIN_EMAIL,
  ]);
  const context = await browser.newContext(
    phone
      ? {
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 2,
        }
      : { viewport: { width: 1440, height: 900 } },
  );
  const page = await context.newPage();
  await signIn(page, ADMIN_EMAIL);
  return { page, close: () => context.close() };
}

const node = (page: Page, id: string) => page.locator(`[data-node="${id}"]`);
const detail = (page: Page) => page.getByTestId("system-detail");

test("a signed-in person who is not an admin gets a real 404 and nothing of the register", async ({
  page,
}) => {
  await arrive(page, "notsysadmin");
  const load = await page.goto("/admin/system");
  expect(load?.status()).toBe(404);
  const html = await (await page.request.get("/admin/system")).text();
  const rsc = await page.request.get("/admin/system", { headers: { RSC: "1" } });
  expect(rsc.status()).toBe(404);
  for (const secret of ["R-PRIV-1", "privileged-ops", "Architecture register", "svc-scans"]) {
    expect(html).not.toContain(secret);
    expect(await rsc.text()).not.toContain(secret);
  }
});

test("a signed-out visitor is sent to sign-in and sees nothing of the register", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/admin/system");
  await expect(page).toHaveURL(/\/sign-in/);
  expect(await page.content()).not.toContain("svc-scans");
  const rsc = await page.request.get("/admin/system", { headers: { RSC: "1" }, maxRedirects: 0 });
  expect(rsc.status()).not.toBe(200);
  await context.close();
});

test.describe("the Architecture Control Center, as an admin", () => {
  test.skip(({ isMobile }) => isMobile, "desktop flow; the phone has its own test below");

  test("the map, tracing, impact, paths, search, filters, views and deep links", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { page, close } = await asAdmin(browser, false);
    const requests: string[] = [];
    await page.goto("/admin/system");
    await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Architecture" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    // every component of the register is drawn; the KPI and the map agree
    const total = Number(await page.locator("dt:text-is('Components') + dd").first().innerText());
    expect(total).toBeGreaterThan(50);
    await expect(page.locator("[data-node]")).toHaveCount(total);
    await expect(page.locator("[data-edge]").first()).toBeAttached();
    page.on("request", (r) => {
      if (!r.url().includes("/_next/static/")) requests.push(r.url());
    });

    // select: the detail panel, the direct trace, then the whole downstream trace
    await node(page, "svc-scans").click();
    await expect(detail(page).getByRole("heading", { name: "Scan recognition" })).toBeVisible();
    await expect(detail(page).getByText(/^Uses \(\d+\)$/)).toBeVisible();
    const direct = await page.getByTestId("trace-summary").innerText();
    await detail(page).getByRole("radio", { name: "Uses" }).click();
    await detail(page).getByRole("radio", { name: "All" }).click();
    const deep = await page.getByTestId("trace-summary").innerText();
    expect(direct).not.toBe(deep);
    // a dimmed component is outside the trace; one in it is not
    await expect(node(page, "openai")).toHaveCSS("opacity", "1");
    await expect(node(page, "svc-wishlist")).not.toHaveCSS("opacity", "1");

    // evidence: the file that proves an edge
    await detail(page).getByRole("button", { name: "evidence" }).first().click();
    await expect(
      detail(page).locator("a[href*='github.com/Blockionaire/CELLR/blob/main/']").first(),
    ).toBeVisible();

    // impact: what stops working if the database fails
    await node(page, "supabase-postgres").click();
    await expect(page.getByTestId("impact-list").getByRole("button")).not.toHaveCount(0);
    await expect(page.getByTestId("impact-list")).toContainText("Cellar service");

    // the shortest path from the app to OpenAI
    await node(page, "app-pwa").click();
    await page.getByLabel(/Shortest path from/).selectOption("openai");
    await expect(page.getByTestId("path-result").locator("li")).not.toHaveCount(0);
    await expect(page.getByTestId("path-result")).toContainText("OpenAI-compatible API");

    // search: a table name finds its group; Enter selects it
    const search = page.getByLabel("Search components, tables, routes, files");
    await page.keyboard.press("Escape");
    await page.locator("body").press("/");
    await expect(search).toBeFocused();
    await search.fill("sommelier_feedback");
    await expect(page.getByText("1 found")).toBeVisible();
    await search.press("Enter");
    await expect(detail(page).getByRole("heading", { name: "Sommelier history" })).toBeVisible();
    await search.fill("");

    // filters: hiding a kind of line removes those lines
    const feedback = page.locator("[data-edge$=':feedback']");
    expect(await feedback.count()).toBeGreaterThan(0);
    await page
      .getByRole("group", { name: "Show lines of kind" })
      .getByRole("button", { name: "Feedback" })
      .click();
    await expect(feedback).toHaveCount(0);
    await page.getByRole("button", { name: "Show everything again" }).click();
    expect(await feedback.count()).toBeGreaterThan(0);

    // keyboard: a component outside the view is brought into view when it gets focus; Enter selects it
    await node(page, "svc-insights").focus();
    await expect(node(page, "svc-insights")).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(node(page, "svc-insights")).toHaveAttribute("aria-pressed", "true");

    // the deep link restores the selection
    await expect(page).toHaveURL(/#c=svc-insights/);
    await page.reload();
    await expect(
      detail(page).getByRole("heading", { name: "Wine insights & valuation" }),
    ).toBeVisible();

    // the other views
    await page.getByRole("tab", { name: "Register" }).click();
    await expect(page.getByTestId("register-table").locator("tbody tr")).toHaveCount(total);
    // opening a component from another view centres the map on it (the map mounts after the request)
    await page.getByTestId("register-table").getByRole("button", { name: "Koopcheck" }).click();
    await expect(page.getByRole("tab", { name: "Map" })).toHaveAttribute("aria-selected", "true");
    await expect(node(page, "svc-purchase-check")).toBeInViewport({ ratio: 0.9 });
    await expect(detail(page).getByRole("heading", { name: "Koopcheck" })).toBeVisible();
    await page.getByRole("tab", { name: "Register" }).click();
    await page.getByRole("tab", { name: "Flows" }).click();
    await expect(page.getByTestId("flows").locator("li h3")).not.toHaveCount(0);
    await page.getByRole("button", { name: "Show on the map" }).first().click();
    await expect(page.getByText(/^Showing the flow/)).toBeVisible();
    await page.getByRole("tab", { name: "Data" }).click();
    await expect(page.getByTestId("buckets")).toContainText("no code reference");
    await page.getByRole("tab", { name: "Review" }).click();
    await expect(page.getByTestId("review")).toContainText("R-PRIV-1");
    await page.getByRole("tab", { name: "Checks" }).click();
    await expect(page.getByTestId("checks")).toContainText(
      "consistent with the repository inventory",
    );

    // it fetched nothing of its own after the page loaded: nothing else needs to be up
    expect(requests.filter((u) => /\/api\/|supabase|:54321/.test(u))).toEqual([]);

    await page.getByRole("tab", { name: "Map" }).click();
    expect(await audit(page)).toEqual([]);
    await close();
  });
});

test.describe("on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "phone project");

  test("usable at 390 px: no sideways scroll, a component opens from the register, the map pans", async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const { page, close } = await asAdmin(browser, true);
    await page.goto("/admin/system");
    await expect(page.getByTestId("system-map")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByRole("tab", { name: "Register" }).click();
    await page.getByTestId("register-table").getByRole("button", { name: "AI sommelier" }).click();
    await expect(page.getByRole("tab", { name: "Map" })).toHaveAttribute("aria-selected", "true");
    await expect(detail(page).getByRole("heading", { name: "AI sommelier" })).toBeInViewport();

    // a component on the map responds to a tap
    await node(page, "svc-sommelier").tap();
    await expect(node(page, "svc-sommelier")).toHaveAttribute("aria-pressed", "true");
    expect(await audit(page)).toEqual([]);
    await close();
  });
});
