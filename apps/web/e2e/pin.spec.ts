import { expect, test, type BrowserContextOptions, type Page } from "@playwright/test";
import { codeFor, onboardCreate, sql, uniqueEmail } from "./helpers";

const shot = (name: string) => `test-results/shots/${name}.png`;
const project = () => test.info().project.name;
const PIN = "482916";

/** Taps the digits on the number pad, like a thumb would. */
async function tapPin(page: Page, pin: string) {
  for (const d of pin) await page.getByRole("button", { name: d, exact: true }).click();
}

async function emailAndCode(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("6-digit code").fill(await codeFor(email));
}

test.describe("sign-in PIN", () => {
  test("set it right after the email code, then come back with only the PIN — on any device", async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    const email = uniqueEmail("pin");
    await emailAndCode(page, email);

    // The offer, then choosing: an easy PIN is refused, two different ones are too.
    const offer = page.getByTestId("pin-offer");
    await expect(offer.getByRole("heading", { name: "Sign in faster next time?" })).toBeVisible();
    await page.screenshot({ path: shot(`pin-offer-${project()}`), fullPage: true });
    await offer.getByRole("button", { name: "Set a PIN" }).click();
    await tapPin(page, "123456");
    const setup = page.getByTestId("pin-setup");
    await expect(setup.getByRole("alert")).toHaveText(
      "That one is too easy to guess. Try another.",
    );
    await tapPin(page, PIN);
    await expect(page.getByText("And once more, to be sure.")).toBeVisible();
    await tapPin(page, "482917");
    await expect(setup.getByRole("alert")).toHaveText(
      "Those were not the same. Choose your PIN again.",
    );
    await tapPin(page, PIN);
    await tapPin(page, PIN);
    await onboardCreate(page, "Pin House", "Pim");
    const [row] = await sql<{ pin_hash: string }>(
      "select p.pin_hash from public.account_pins p join auth.users u on u.id = p.user_id where u.email = $1",
      [email],
    );
    expect(row?.pin_hash).toMatch(/^scrypt\$/); // only a hash is kept
    expect(row?.pin_hash).not.toContain(PIN);

    // Signed out: this phone opens straight on the PIN.
    await page.goto("/profile");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await page.screenshot({ path: shot(`pin-sign-in-${project()}`), fullPage: true });
    await tapPin(page, "111222");
    await expect(page.getByText("That PIN didn't work.", { exact: false })).toBeVisible();
    await tapPin(page, PIN);
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));

    // Another device (the app on the home screen keeps its own storage): email, then the PIN. No code.
    const context = await browser.newContext(test.info().project.use as BrowserContextOptions);
    const other = await context.newPage();
    await other.goto("/sign-in");
    await other.getByLabel("Email").fill(email.toUpperCase());
    await other.getByRole("button", { name: "Sign in with my PIN" }).click();
    await tapPin(other, PIN);
    await other.waitForURL((url) => url.pathname === "/");
    await expect(other.getByRole("heading", { level: 1 })).toContainText("Pim");
    await context.close();
  });

  test("five wrong tries switch the PIN off; an email without a PIN answers the same", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("pinlock");
    await emailAndCode(page, email);
    await page.getByTestId("pin-offer").getByRole("button", { name: "Set a PIN" }).click();
    await tapPin(page, PIN);
    await tapPin(page, PIN);
    await page.waitForURL(/\/onboarding$/);

    const tryPin = (address: string, pin: string) =>
      request.post("/api/v1/auth/pin", {
        data: { email: address, pin },
        headers: { origin: new URL(page.url()).origin },
      });
    const nobody = await tryPin(uniqueEmail("nopin"), PIN);
    expect(nobody.status()).toBe(422);
    expect(((await nobody.json()) as { error: { code: string } }).error.code).toBe("PIN_INVALID");

    for (let i = 0; i < 5; i++) expect((await tryPin(email, "000111")).status()).toBe(422);
    // Off now: even the right PIN no longer works, and the email code is the way back in.
    expect((await tryPin(email, PIN)).status()).toBe(422);
    expect(
      await sql(
        "select 1 from public.account_pins p join auth.users u on u.id = p.user_id where u.email = $1",
        [email],
      ),
    ).toHaveLength(0);
  });

  test("Profile: change it or switch it off", async ({ page }) => {
    const email = uniqueEmail("pinprofile");
    await emailAndCode(page, email);
    await page.getByTestId("pin-offer").getByRole("button", { name: "Not now" }).click();
    await onboardCreate(page, "No Pin House", "Noor");
    await page.goto("/profile");
    const section = page.getByTestId("pin");
    await section.getByRole("button", { name: "Set a PIN" }).click();
    const dialog = page.getByRole("dialog");
    await tapPin(page, PIN);
    await tapPin(page, PIN);
    await expect(dialog).toBeHidden();
    await expect(section).toContainText("On: you sign in with your 6-digit PIN");
    await section.getByRole("button", { name: "Switch off" }).click();
    await expect(section).toContainText("Sign in with a 6-digit PIN instead");
    expect(
      await sql(
        "select 1 from public.account_pins p join auth.users u on u.id = p.user_id where u.email = $1",
        [email],
      ),
    ).toHaveLength(0);
  });
});
