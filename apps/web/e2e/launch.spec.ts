import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { arrive } from "./helpers";

/**
 * Sprint M, opening the app. The first page is prepared on the server behind the signed-in check; until then the
 * screen used to stay blank. Now the launch screen is the first thing sent, it gives way to the app by itself,
 * and nothing of it is left over the app afterwards.
 */
test.skip(({ isMobile }) => !isMobile, "the launch screen on a phone");

const SHOTS = process.env.SHOTS_DIR ?? "test-results/shots";

/**
 * What the screen shows while the server is still working: the page as it is sent up to that moment (the head and
 * the launch screen, without the app that follows), so the wait can be held still and looked at. The launch
 * screen itself needs no script.
 */
async function holdAtLaunch(page: Page) {
  // No scripts: the app would otherwise notice the rest of the page never comes and show an error instead.
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await page.route("**/", async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    const html = await response.text();
    const cut = html.indexOf('<div hidden id="S:');
    expect(
      cut,
      "the app arrives after the launch screen, in a later part of the page",
    ).toBeGreaterThan(0);
    await route.fulfill({ response, body: html.slice(0, cut) });
  });
}

test("opening the app: the launch screen comes first, then the app, and nothing stays on top", async ({
  page,
}) => {
  await arrive(page, "launch1");

  // The first bytes of the page already carry the launch screen; the app follows later in the same response.
  const html = await (await page.request.get("/")).text();
  const splash = html.indexOf('data-testid="boot-splash"');
  expect(splash).toBeGreaterThan(0);
  expect(splash).toBeLessThan(html.indexOf('id="main"'));
  // The iPhone launch images are offered, one per screen size, and can be fetched without signing in.
  expect(html.match(/rel="apple-touch-startup-image"/g)?.length).toBe(11);
  const image = await page.context().request.fetch("/splash/iphone-393x852@3.png", {
    headers: { cookie: "" },
  });
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");

  // Opening it for real: the app replaces the launch screen.
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByTestId("boot-splash")).toHaveCount(0);
  // The hand-over picture belongs to the home-screen app only; in a tab it is never shown…
  await expect(page.getByTestId("boot-handoff")).toBeHidden();
  // …and whatever is in the middle of the screen is the app, not a leftover layer.
  const top = await page.evaluate(() => {
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return el?.closest(".boot-splash") ? "boot" : "app";
  });
  expect(top).toBe("app");
});

test("the launch screen on an iPhone: centred, clear of the notch and home indicator, calm when asked", async ({
  browser,
  page,
}) => {
  await arrive(page, "launch2");
  const state = await page.context().storageState();
  fs.mkdirSync(SHOTS, { recursive: true });

  for (const motion of ["no-preference", "reduce"] as const) {
    const context = await browser.newContext({
      storageState: state,
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: "light", // fixed dark in both themes
      reducedMotion: motion,
      locale: "en-GB",
    });
    const p = await context.newPage();
    await holdAtLaunch(p);
    await p.goto("/");
    const splash = p.getByTestId("boot-splash");
    await expect(splash).toBeAttached();
    await expect(p.getByRole("status").filter({ hasText: "Loading CELLR" })).toBeAttached();

    // It covers the whole screen, and the logo sits in the middle, well clear of the top and bottom insets.
    const box = (await splash.boundingBox())!;
    expect(box).toEqual({ x: 0, y: 0, width: 393, height: 852 });
    const logo = (await splash.locator('[aria-label="CELLR"]').boundingBox())!;
    expect(Math.abs(logo.x + logo.width / 2 - 393 / 2)).toBeLessThan(1);
    expect(logo.y).toBeGreaterThan(59 + 100);
    expect(logo.y + logo.height).toBeLessThan(852 - 34 - 200);

    // The words come only once it takes a moment; the passing light stops for reduced motion.
    await expect
      .poll(() => splash.locator(".boot-text").evaluate((el) => getComputedStyle(el).opacity), {
        timeout: 5000,
      })
      .toBe("1");
    const glow = await splash
      .locator(".boot-glow")
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(glow).toBe(motion === "reduce" ? "none" : "boot-breathe");
    await p.screenshot({ path: path.join(SHOTS, `launch-${motion}.png`) });
    await context.close();
  }
});

test("the hand-over in the home-screen app dissolves into the app and never stays", async ({
  browser,
  page,
}) => {
  await arrive(page, "launch3");
  // A browser test cannot open the page as a home-screen app, so the app's own rule for that mode (the
  // `(display-mode: standalone)` block in globals.css) is applied by hand; the keyframes are the real ones.
  // (Adding a style needs the page's content policy set aside, in this test only.)
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    bypassCSP: true,
  });
  const p = await context.newPage();
  await p.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent =
        ".boot-handoff{display:block!important;animation:boot-dissolve 420ms ease-out 120ms forwards!important}";
      document.head.append(style);
    });
  });
  await p.goto("/");
  const handoff = p.getByTestId("boot-handoff");
  await expect.poll(() => handoff.evaluate((el) => getComputedStyle(el).display)).toBe("block");
  // It never takes a tap, even while it is still there…
  expect(await handoff.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  // …and within about half a second it is gone, leaving the app.
  await expect
    .poll(() => handoff.evaluate((el) => getComputedStyle(el).visibility), { timeout: 3000 })
    .toBe("hidden");
  await expect(p.getByRole("main")).toBeVisible();
  await context.close();
});
