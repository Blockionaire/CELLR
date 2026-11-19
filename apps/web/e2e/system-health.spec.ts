import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { STACK, arrive, audit, signIn, sql } from "./helpers";

/**
 * System Intelligence sprint 2: the live monitoring engine against the real local stack (Postgres with migration
 * 0047, PostgREST, the fake Auth and Storage). Real measurements, real simulated outages (the stack answers errors or
 * slowly to probe requests only), real stale data. What must hold:
 *   - a missing, stale or failed measurement is never shown as healthy;
 *   - an outage of Auth, Storage or the database is detected, and the heartbeat's answer says so;
 *   - monitoring being slow or gone never blocks the architecture map;
 *   - nothing of it is visible to non-admins or in public endpoints.
 */
const ADMIN_ID = "00000000-0000-4000-8000-00000000ad01";
const ADMIN_EMAIL = "feedback-admin@cellr.invalid";
const CRON = { authorization: "Bearer local-stack-cron" };
const READY = { authorization: "Bearer local-stack-ready-token-000000000000" };

async function asAdmin(browser: Browser, phone = false) {
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

const outage = (request: APIRequestContext, target: "auth" | "storage" | "rest", o: object) =>
  request.post(`${STACK}/__test/outage`, { data: { target, ...o } });
const clearOutages = (request: APIRequestContext) => request.delete(`${STACK}/__test/outage`);
/** Moves every round and sample back in time, so the next round is not refused as too soon (one a minute). */
const age = (minutes: number) =>
  sql(
    `update private.health_rounds set started_at = started_at - make_interval(mins => $1),
            finished_at = finished_at - make_interval(mins => $1);
     update private.health_samples set measured_at = measured_at - make_interval(mins => $1);`.replace(
      /\$1/g,
      String(minutes),
    ),
  );
const round = (request: APIRequestContext) => request.get("/api/cron/health", { headers: CRON });
const probe = (page: Page, id: string) => page.locator(`[data-probe="${id}"]`);

test.describe("public endpoints and the boundary", () => {
  test("liveness says ok and nothing else; it needs nothing and reveals nothing", async ({
    request,
  }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers()["cache-control"]).toBe("no-store");
  });

  test("the probe round and readiness refuse anyone without their secret", async ({ request }) => {
    expect((await request.get("/api/cron/health")).status()).toBe(401);
    expect(
      (
        await request.get("/api/cron/health", { headers: { authorization: "Bearer nope" } })
      ).status(),
    ).toBe(401);
    expect((await request.get("/api/health/ready")).status()).toBe(401);
    expect(
      (
        await request.get("/api/health/ready", { headers: { authorization: "Bearer nope" } })
      ).status(),
    ).toBe(401);
  });

  test("a signed-in person who is not an admin gets a real 404 and nothing of the health data", async ({
    page,
  }) => {
    await arrive(page, "nothealthadmin");
    expect((await page.goto("/admin/system/health"))?.status()).toBe(404);
    const html = await (await page.request.get("/admin/system/health")).text();
    const rsc = await page.request.get("/admin/system/health", { headers: { RSC: "1" } });
    expect(rsc.status()).toBe(404);
    const body = html + (await rsc.text());
    for (const secret of ["Database read", "monitor.round", "Measure now", "Dead man"])
      expect(body).not.toContain(secret);
  });
});

test.describe("measuring, outages and stale data", () => {
  test.describe.configure({ mode: "serial" });
  // one browser at a time changes the shared health state; the phone has its own read-only test below
  test.skip(({ isMobile }) => isMobile, "desktop only: these tests change shared state");

  test.beforeAll(async ({ request }) => {
    await clearOutages(request);
    await sql("delete from private.health_rounds");
  });
  test.afterAll(async ({ request }) => {
    await clearOutages(request);
  });

  test("before any round: nothing is healthy, the monitor never ran", async ({ browser }) => {
    const { page, close } = await asAdmin(browser);
    await page.goto("/admin/system/health");
    await expect(page.getByTestId("health-headline")).toHaveAttribute("data-monitor", "never");
    await expect(page.getByTestId("health-headline")).toHaveAttribute("data-status", "unknown");
    await expect(page.locator('[data-probe][data-status="healthy"]')).toHaveCount(0);
    await expect(probe(page, "db.read")).toHaveAttribute("data-reason", "never_measured");
    expect(await audit(page)).toEqual([]);
    await close();
  });

  test("a round measures for real: what answers is healthy, what cannot be judged is unknown", async ({
    browser,
    request,
  }) => {
    const res = await round(request);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      recorded: true,
      outcome: "ok",
      failedInfrastructure: 0,
    });
    // a second one right away is refused: rounds are bounded, whoever asks
    expect(await (await round(request)).json()).toEqual({
      ok: true,
      recorded: false,
      reason: "too_soon",
    });

    const { page, close } = await asAdmin(browser);
    await page.goto("/admin/system/health");
    await expect(page.getByTestId("health-headline")).toHaveAttribute("data-monitor", "running");
    for (const id of ["monitor.round", "db.read", "db.write", "auth.api", "storage.api"])
      await expect(probe(page, id), id).toHaveAttribute("data-status", "healthy");
    // the local stack has no pg_cron: that is unknown, not healthy and not failed
    await expect(probe(page, "cron.extension")).toHaveAttribute("data-reason", "not_available");
    await expect(probe(page, "cron.health-samples-purge")).toHaveAttribute(
      "data-status",
      "unknown",
    );
    // no tokens here: CI and deployment are unknown (not configured)
    await expect(probe(page, "delivery.ci")).toHaveAttribute("data-reason", "not_configured");
    // so the headline does not call the system healthy
    await expect(page.getByTestId("health-headline")).not.toHaveAttribute("data-status", "healthy");
    await expect(page.getByTestId("health-config")).toContainText("Not configured");

    const ready = await request.get("/api/health/ready", { headers: READY });
    expect(ready.status()).toBe(200);
    expect(await ready.json()).toEqual({ status: "ok", monitor: "running" });
    await page.screenshot({ path: "test-results/shots/health-desktop.png", fullPage: true });
    await close();
  });

  test("an Auth outage is detected, shown on the map, and raised by the heartbeat and readiness", async ({
    browser,
    request,
  }) => {
    await outage(request, "auth", { status: 503 });
    await age(2);
    const { page, close } = await asAdmin(browser);
    await page.goto("/admin/system/health");
    // the admin's own button runs the same bounded round
    await page.getByRole("button", { name: "Measure now" }).click();
    await expect(page.getByTestId("health-message")).toContainText("Measured");
    await expect(probe(page, "auth.api")).toHaveAttribute("data-status", "failed");
    await expect(probe(page, "auth.api")).toHaveAttribute("data-reason", "http_503");
    await expect(page.getByTestId("health-headline")).toHaveAttribute("data-status", "failed");
    // the error's text is never shown: only its code
    await expect(page.locator("main")).not.toContainText("simulated outage");

    const ready = await request.get("/api/health/ready", { headers: READY });
    expect(ready.status()).toBe(503);
    expect(await ready.json()).toEqual({ status: "failed", monitor: "running" });

    // the map's overlay: Auth failed, a component no check measures has no badge
    await page.goto("/admin/system");
    await expect(page.getByTestId("health-line")).toHaveAttribute("data-state", "available");
    await expect(page.locator('[data-node="supabase-auth"]')).toHaveAttribute(
      "data-health",
      "failed",
    );
    await expect(page.locator('[data-node="supabase-postgres"]')).toHaveAttribute(
      "data-health",
      "healthy",
    );
    await expect(page.locator('[data-node="svc-cellar"]')).toHaveAttribute("data-health", "none");
    await page.locator('[data-node="supabase-auth"]').click();
    await expect(page.getByTestId("component-health")).toContainText("Failed");
    expect(await audit(page)).toEqual([]);
    await page.screenshot({ path: "test-results/shots/health-overlay-desktop.png" });
    // the overlay can be switched off; the map stays the same
    await page.getByRole("button", { name: "Health overlay" }).click();
    await expect(page.locator('[data-node="supabase-auth"]')).not.toHaveAttribute(
      "data-health",
      /.*/,
    );

    // the heartbeat's own answer counts the failed infrastructure check
    await age(2);
    const res = await round(request);
    expect(await res.json()).toMatchObject({ recorded: true, failedInfrastructure: 1 });
    await clearOutages(request);
    await close();
  });

  test("a Storage that hangs is failed by its time limit, and the round still finishes in time", async ({
    request,
    browser,
  }) => {
    await outage(request, "storage", { delayMs: 8000 });
    await age(2);
    const t = Date.now();
    const res = await round(request);
    expect(Date.now() - t).toBeLessThan(7000);
    expect(await res.json()).toMatchObject({ recorded: true, failedInfrastructure: 1 });
    await clearOutages(request);
    const { page, close } = await asAdmin(browser);
    await page.goto("/admin/system/health");
    await expect(probe(page, "storage.api")).toHaveAttribute("data-reason", "timeout");
    await close();
  });

  test("a database outage: nothing can be recorded, and the heartbeat is told so (503)", async ({
    request,
  }) => {
    await outage(request, "rest", { status: 503 });
    await age(2);
    const res = await round(request);
    expect(res.status()).toBe(503);
    expect(await res.json()).toEqual({
      ok: false,
      recorded: false,
      reason: "database_unreachable",
    });
    const ready = await request.get("/api/health/ready", { headers: READY });
    expect(ready.status()).toBe(503);
    await clearOutages(request);
  });

  test("monitoring that is slow never blocks the map; the Health page says why it has nothing", async ({
    browser,
    request,
  }) => {
    // every request the monitor makes now hangs; the rest of the app is untouched
    await outage(request, "rest", { delayMs: 10_000 });
    const { page, close } = await asAdmin(browser);
    const t = Date.now();
    await page.goto("/admin/system");
    await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible();
    expect(Date.now() - t).toBeLessThan(8000);
    const total = Number(await page.locator("dt:text-is('Components') + dd").first().innerText());
    await expect(page.locator("[data-node]")).toHaveCount(total);
    await expect(page.getByTestId("health-line")).toHaveAttribute("data-state", "unavailable");
    await expect(page.getByTestId("health-line")).toContainText("did not arrive in time");
    await expect(page.locator("[data-health]")).toHaveCount(0);
    await page.goto("/admin/system/health");
    await expect(page.getByTestId("health-unavailable")).toContainText("did not arrive");
    await clearOutages(request);
    await close();
  });

  test("monitoring not installed (no migration 0047): the map is unaffected and says so", async ({
    browser,
  }) => {
    await sql("alter function public.health_latest() rename to health_latest_off");
    try {
      const { page, close } = await asAdmin(browser);
      await page.goto("/admin/system");
      await expect(page.getByTestId("health-line")).toContainText("migration 0047");
      await expect(page.locator("[data-node]").first()).toBeVisible();
      await page.goto("/admin/system/health");
      await expect(page.getByTestId("health-unavailable")).toContainText("has not been applied");
      await close();
    } finally {
      await sql("alter function public.health_latest_off() rename to health_latest");
    }
  });

  test("stale measurements: when rounds stop, everything reads unknown, nothing healthy", async ({
    browser,
    request,
  }) => {
    await age(40);
    const { page, close } = await asAdmin(browser);
    await page.goto("/admin/system/health");
    await expect(page.getByTestId("health-headline")).toHaveAttribute("data-monitor", "stopped");
    await expect(page.locator('[data-probe][data-status="healthy"]')).toHaveCount(0);
    await expect(probe(page, "db.read")).toHaveAttribute("data-reason", "stale");
    await expect(probe(page, "db.read")).toContainText("last said healthy");
    const ready = await request.get("/api/health/ready", { headers: READY });
    expect(ready.status()).toBe(503);
    expect(await ready.json()).toEqual({ status: "unknown", monitor: "stopped" });
    await page.goto("/admin/system");
    await expect(page.locator('[data-node="supabase-postgres"]')).toHaveAttribute(
      "data-health",
      "unknown",
    );
    await close();
  });
});

test.describe("on a phone", () => {
  test.skip(({ isMobile }) => !isMobile, "phone project");

  test("System › Health is usable at 390 px: no sideways scroll, accessible", async ({
    browser,
  }) => {
    const { page, close } = await asAdmin(browser, true);
    await page.goto("/admin/system/health");
    await expect(page.getByRole("heading", { name: "Health", exact: true })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    expect(await audit(page)).toEqual([]);
    await page.screenshot({ path: "test-results/shots/health-phone.png", fullPage: true });
    await close();
  });
});
