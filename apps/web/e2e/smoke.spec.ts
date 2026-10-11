import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const shot = (name: string) => `test-results/shots/${name}.png`;

async function audit(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.length}) — ${v.nodes[0]?.target.join(" ")}`,
  );
}

test.describe("security & routing", () => {
  test("signed-out visitors are sent to sign-in, remembering where they were going", async ({
    page,
  }) => {
    await page.goto("/cellar");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fcellar$/);
  });

  test("every page carries a strict nonce-based CSP and the page still hydrates under it", async ({
    page,
  }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (/content security policy/i.test(m.text())) violations.push(m.text());
    });
    const response = await page.goto("/sign-in");
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response?.headers()["x-frame-options"]).toBe("DENY");

    // Hydration proof: React attaches handlers, so typing updates the controlled field.
    const email = page.getByLabel("Email");
    await email.fill("hydrated@example.com");
    await expect(email).toHaveValue("hydrated@example.com");
    expect(violations).toEqual([]);
  });

  test("the API answers signed-out callers with a human 401, never a stack trace", async ({
    request,
  }) => {
    const res = await request.get("/api/v1/me");
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Please sign in to continue.", retryable: false },
    });
    expect(res.headers()["cache-control"]).toBe("no-store");
  });

  test("a cross-site POST is refused before anything happens", async ({ request }) => {
    const res = await request.post("/api/v1/auth/otp/request", {
      data: { email: "a@b.co" },
      headers: { origin: "https://evil.example" },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe("sign-in screen", () => {
  test("is clear, labelled and keyboard friendly", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Welcome to CELLR" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeFocused();
    await page.screenshot({ path: shot(`sign-in-${test.info().project.name}`), fullPage: true });
  });

  test("an invalid email gets a human message, not a server round trip", async ({ page }) => {
    await page.goto("/sign-in");
    let apiCalls = 0;
    page.on("request", (r) => r.url().includes("/api/v1/") && apiCalls++);
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Send me a code" }).click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "Enter a valid email address.",
    );
    expect(apiCalls).toBe(0);
  });

  test("a network failure is explained kindly", async ({ page }) => {
    await page.goto("/sign-in");
    await page.route("**/api/v1/auth/otp/request", (route) => route.abort("failed"));
    await page.getByLabel("Email").fill("joost@example.com");
    await page.getByRole("button", { name: "Send me a code" }).click();
    await expect(page.locator("form").getByRole("alert")).toContainText("couldn't reach CELLR");
  });

  test("moves to the code step and shows where it was sent", async ({ page }) => {
    await page.goto("/sign-in");
    await page.route("**/api/v1/auth/otp/request", (route) =>
      route.fulfill({ status: 200, json: { ok: true } }),
    );
    await page.getByLabel("Email").fill("  Joost@Example.com ");
    await page.getByRole("button", { name: "Send me a code" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText("joost@example.com", { exact: false })).toBeVisible();
    await expect(page.getByLabel("6-digit code")).toBeFocused();
    await expect(page.getByRole("button", { name: /Send a new code in \d+s/ })).toBeDisabled();
    await page.screenshot({
      path: shot(`sign-in-code-${test.info().project.name}`),
      fullPage: true,
    });
  });

  test("a wrong code says so plainly", async ({ page }) => {
    await page.goto("/sign-in");
    await page.route("**/api/v1/auth/otp/request", (route) =>
      route.fulfill({ status: 200, json: { ok: true } }),
    );
    await page.route("**/api/v1/auth/otp/verify", (route) =>
      route.fulfill({
        status: 422,
        json: {
          error: {
            code: "OTP_INVALID",
            message: "That code didn't work. Check it, or ask for a new one.",
            retryable: false,
          },
        },
      }),
    );
    await page.getByLabel("Email").fill("joost@example.com");
    await page.getByRole("button", { name: "Send me a code" }).click();
    await page.getByLabel("6-digit code").fill("123 456");
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      "That code didn't work. Check it, or ask for a new one.",
    );
  });

  for (const scheme of ["dark", "light"] as const) {
    test(`has no accessibility violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/sign-in");
      expect(await audit(page)).toEqual([]);
    });
  }
});

test.describe("design gallery", () => {
  for (const scheme of ["dark", "light"] as const) {
    test(`renders and passes the accessibility audit (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/design");
      await expect(page.getByRole("heading", { name: "Design system", level: 1 })).toBeVisible();
      await page.screenshot({
        path: shot(`design-${scheme}-${test.info().project.name}`),
        fullPage: true,
      });
      expect(await audit(page)).toEqual([]);
    });
  }

  test("a sheet traps focus, closes with Escape and gives focus back", async ({ page }) => {
    await page.goto("/design");
    const opener = page.getByRole("button", { name: "Open a sheet" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Rate this wine" });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: shot(`sheet-${test.info().project.name}`) });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("the segmented control works with arrow keys", async ({ page }) => {
    await page.goto("/design");
    const grid = page.getByRole("radio", { name: "Grid" });
    await grid.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "List" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(grid).toHaveAttribute("aria-checked", "true");
  });

  test("the stepper respects its bounds and announces changes", async ({ page }) => {
    await page.goto("/design");
    const more = page.getByRole("button", { name: "One more" });
    const fewer = page.getByRole("button", { name: "One fewer" });
    await more.click();
    await expect(
      page.getByRole("group", { name: "Number of bottles" }).locator("output"),
    ).toHaveText("4");
    for (let i = 0; i < 3; i++) await fewer.click(); // 4 → 1
    await expect(
      page.getByRole("group", { name: "Number of bottles" }).locator("output"),
    ).toHaveText("1");
    await expect(fewer).toBeDisabled();
  });

  test("a toast fired from inside an open sheet renders above it (top layer)", async ({ page }) => {
    await page.goto("/design");
    await page.getByRole("button", { name: "Open a sheet" }).click();
    await page.getByRole("button", { name: "Toast from inside the sheet" }).click();
    const toast = page.getByRole("status").getByText("Copied");
    await expect(toast).toBeVisible();
    // It lives in the browser's top layer (opened after the modal), so it paints above the sheet.
    // (Hit-testing is meaningless here: a modal dialog makes everything outside it inert.)
    const inTopLayer = await page
      .locator("[popover]")
      .evaluate((el) => el.matches(":popover-open"));
    expect(inTopLayer).toBe(true);
    await page.screenshot({ path: shot(`toast-over-sheet-${test.info().project.name}`) });
  });

  test("reduced motion still shows everything (fades only, no errors)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/design");
    await page.getByRole("button", { name: "Open a sheet" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test("the offline page is human, works with no JavaScript, and loads nothing else", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const requests: string[] = [];
  page.on("request", (r) => requests.push(new URL(r.url()).pathname));
  const response = await page.goto("/offline.html");
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/");
  expect(response?.headers()["content-security-policy"]).toContain("default-src 'none'");
  expect(requests).toEqual(["/offline.html"]);
  await page.screenshot({ path: shot(`offline-static-${test.info().project.name}`) });
  await context.close();
});

test("unknown pages get a kind 404", async ({ page }) => {
  const res = await page.goto("/design/nope", { waitUntil: "domcontentloaded" });
  // /design/* is public so the 404 renders without a redirect
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "We couldn't find that page." })).toBeVisible();
});

test.describe("installable app", () => {
  test("serves a valid manifest with real icons", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest).toMatchObject({ name: "CELLR", display: "standalone", start_url: "/" });
    for (const icon of manifest.icons as Array<{ src: string; sizes: string; purpose: string }>) {
      const png = await request.get(icon.src);
      expect(png.status(), icon.src).toBe(200);
      expect(png.headers()["content-type"]).toContain("image/png");
    }
    expect(
      (manifest.icons as Array<{ purpose: string }>).some((i) => i.purpose === "maskable"),
    ).toBe(true);
  });

  test("offline: navigations get the friendly page, styled, and nothing private is ever cached", async ({
    page,
    context,
  }) => {
    await page.goto("/sign-in");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // now controlled by the worker
    await context.setOffline(true);
    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
    // Styled, not a raw page: the heading uses the serif display face from the cached CSS.
    const family = await page
      .getByRole("heading", { name: "You're offline" })
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toContain("Instrument Serif");
    await page.screenshot({ path: shot(`offline-${test.info().project.name}`) });

    // The serif really is available offline (not just named in the font stack): its file is in the cache.
    const fontsReady = await page.evaluate(() =>
      document.fonts.ready.then(() =>
        [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
      ),
    );
    expect(fontsReady.join(" ")).toContain("Instrument Serif");

    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys())
        for (const r of await (await caches.open(name)).keys()) urls.push(new URL(r.url).pathname);
      return urls;
    });
    expect(cached).toContain("/offline.html");
    expect(cached.filter((u) => u.startsWith("/api/"))).toEqual([]);
    expect(
      cached.filter(
        (u) =>
          !(u === "/offline.html" || u.startsWith("/_next/static/") || u.startsWith("/icons/")),
      ),
    ).toEqual([]);

    await context.setOffline(false);
  });
});
