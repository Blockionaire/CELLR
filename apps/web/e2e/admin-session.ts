import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { codeFor, sql } from "./helpers";

/**
 * Signing in as the one test admin (CELLR_ADMIN_USER_IDS in playwright.config.ts), for the admin specs.
 *
 * Many specs sign in as this admin at the same time, and a new one-time code makes the previous one stale, so a
 * sign-in can lose that race: each attempt has its own time limit and is tried again a little later.
 */
export const ADMIN_ID = "00000000-0000-4000-8000-00000000ad01";
export const ADMIN_EMAIL = "feedback-admin@cellr.invalid";

type Options = Parameters<Browser["newContext"]>[0];
type Session = Awaited<ReturnType<BrowserContext["storageState"]>>;

export const ensureAdmin = () =>
  sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
    ADMIN_ID,
    ADMIN_EMAIL,
  ]);

/**
 * Signs in on the sign-in page the browser is on (or opens it), the way a person does, and waits until the app
 * leaves it: where to depends on the page's `next`, so a test can follow a real "sign in, back to where I was".
 */
export async function signInHere(page: Page, attempts = 3) {
  await ensureAdmin();
  for (let attempt = 1; ; attempt++) {
    try {
      if (!new URL(page.url()).pathname.startsWith("/sign-in")) await page.goto("/sign-in");
      await page.getByLabel("Email").fill(ADMIN_EMAIL);
      await page.getByRole("button", { name: "Send me a code" }).click();
      await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
      await page.getByLabel("6-digit code").fill(await codeFor(ADMIN_EMAIL));
      await page.waitForFunction(
        () =>
          !location.pathname.startsWith("/sign-in") ||
          document.querySelector('[data-testid="pin-offer"]') !== null,
        null,
        { timeout: 20_000 },
      );
      if (new URL(page.url()).pathname.startsWith("/sign-in"))
        await page.getByTestId("pin-offer").getByRole("button", { name: "Not now" }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 20_000 });
      return;
    } catch (e) {
      if (attempt === attempts) throw e;
      // start over on the same sign-in address (it keeps `next`)
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 2_000));
      await page.goto(
        new URL(page.url()).pathname.startsWith("/sign-in") ? page.url() : "/sign-in",
      );
    }
  }
}

/** One signed-in session per worker, reused: fewer sign-ins racing each other. */
let session: Promise<Session> | null = null;

/** A browser context signed in as the admin (from the worker's shared session). */
export async function adminContext(browser: Browser, options: Options = {}) {
  session ??= (async () => {
    const context = await browser.newContext(options);
    try {
      await signInHere(await context.newPage());
      return await context.storageState();
    } finally {
      await context.close();
    }
  })().catch((e) => {
    session = null;
    throw e;
  });
  const context = await browser.newContext({ ...options, storageState: await session });
  const page = await context.newPage();
  return { page, context, close: () => context.close() };
}

/** A context with a session of its own (for a test that signs out: the shared session must not end). */
export async function freshAdminContext(browser: Browser, options: Options = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await signInHere(page);
  return { page, context, close: () => context.close() };
}
