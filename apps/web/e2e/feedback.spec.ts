import { expect, test } from "@playwright/test";
import { api, arrive, audit, bearer, sessionToken, signIn, sql, stamp } from "./helpers";

/** The admin the test server is started with (playwright.config.ts → CELLR_ADMIN_USER_IDS). */
const ADMIN_ID = "00000000-0000-4000-8000-00000000ad01";
const ADMIN_EMAIL = "feedback-admin@cellr.invalid";

const rowsOf = (email: string) =>
  sql<{ category: string; message: string; location: string | null; device: string | null }>(
    `select f.category, f.message, f.location, f.device from public.beta_feedback f
       join auth.users u on u.id = f.user_id where u.email = $1 order by f.created_at`,
    [email],
  );

test.describe("beta feedback", () => {
  test("from Profile: a short, checked form; one tap sends once; it is stored for me only", async ({
    page,
  }) => {
    const { email } = await arrive(page, "feedback");
    await page.goto("/profile");
    await page.getByTestId("feedback-entry").click();
    const sheet = page.getByRole("dialog", { name: "Share feedback" });
    await expect(sheet.getByText(/Never include passwords, login codes/)).toBeVisible();

    // Nothing chosen, nothing written: said plainly, nothing sent.
    await sheet.getByRole("button", { name: "Send feedback" }).click();
    await expect(sheet.getByText("Choose what it is about.")).toBeVisible();
    await expect(sheet.getByText("Write at least 10 characters.")).toBeVisible();

    // The device line is shown before it could be sent, and is off by default.
    await expect(sheet.getByTestId("device-preview")).toContainText(" · ");
    await expect(sheet.getByRole("checkbox")).not.toBeChecked();
    expect(await audit(page)).toEqual([]);

    const text = `Scanning ${stamp()}: I tapped Add and nothing happened. I expected the bottle in my cellar.`;
    await sheet.getByRole("radio", { name: "Bug" }).click();
    await sheet.getByLabel("Your feedback").fill(text);
    await sheet.getByLabel("Where did it happen? (optional)").selectOption("scan");
    await sheet.getByRole("button", { name: "Send feedback" }).dblclick();
    await expect(sheet.getByText("Thank you!")).toBeVisible();
    expect(await rowsOf(email)).toEqual([
      { category: "bug", message: text, location: "scan", device: null },
    ]);

    // Again, now with the device line: only that coarse line is stored.
    await sheet.getByRole("button", { name: "Send more feedback" }).click();
    await sheet.getByRole("radio", { name: "Idea" }).click();
    await sheet.getByLabel("Your feedback").fill("Sort my journal by region, please.");
    await sheet.getByRole("checkbox").check();
    await sheet.getByRole("button", { name: "Send feedback" }).click();
    await expect(sheet.getByText("Thank you!")).toBeVisible();
    const [, second] = await rowsOf(email);
    expect(second!.device).toMatch(/^[A-Za-z ]+ · [A-Za-z ]+ · (browser tab|home-screen app)$/);
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toBeHidden();
  });

  test("a failed send keeps the text and can be tried again", async ({ page }) => {
    await arrive(page, "feedbackretry");
    let calls = 0;
    await page.route("**/api/v1/feedback", (route) => {
      calls += 1;
      return calls === 1 ? route.abort("connectionreset") : route.continue();
    });
    await page.goto("/profile");
    await page.getByTestId("feedback-entry").click();
    const sheet = page.getByRole("dialog", { name: "Share feedback" });
    await sheet.getByRole("radio", { name: "Confusing" }).click();
    await sheet.getByLabel("Your feedback").fill("I could not find where to change the language.");
    await sheet.getByRole("button", { name: "Send feedback" }).click();
    await expect(sheet.getByText(/That didn't send/)).toBeVisible();
    await expect(sheet.getByLabel("Your feedback")).toHaveValue(
      "I could not find where to change the language.",
    );
    await sheet.getByRole("button", { name: "Try again" }).click();
    await expect(sheet.getByText("Thank you!")).toBeVisible();
    expect(calls).toBe(2);
  });

  test("in Dutch, on a small phone", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 667 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const { email } = await arrive(page, "feedbacknl");
    await api(page.request, await sessionToken(email), "patch", "/me", { locale: "nl" });
    await page.goto("/profile");
    await page.getByTestId("feedback-entry").click();
    const sheet = page.getByRole("dialog", { name: "Feedback geven" });
    await expect(sheet.getByRole("radio", { name: "Onduidelijk" })).toBeVisible();
    const send = sheet.getByRole("button", { name: "Feedback versturen" });
    await send.scrollIntoViewIfNeeded();
    await expect(send).toBeInViewport();
    expect(await audit(page)).toEqual([]);
    await context.close();
  });

  test("the API: signed in only, as yourself, bounded, rate limited, and never readable", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "feedbackapi");
    const token = await sessionToken(email);
    const other = await sql<{ id: string }>("select id from auth.users where email <> $1 limit 1", [
      email,
    ]);
    const body = { category: "other", message: "Plain feedback from the API test." };

    // No session: refused before anything is read (no credentials at all, or a token that is not one).
    expect((await request.post("/api/v1/feedback", { data: body })).status()).toBe(403);
    expect(
      (await request.post("/api/v1/feedback", { headers: bearer("nope"), data: body })).status(),
    ).toBe(401);
    expect(
      (await api(request, token, "post", "/feedback", { ...body, category: "x" })).status(),
    ).toBe(422);
    expect(
      (await api(request, token, "post", "/feedback", { ...body, message: "short" })).status(),
    ).toBe(422);
    // A user id in the body is ignored: it is stored for the caller.
    const sent = await api(request, token, "post", "/feedback", { ...body, userId: other[0]?.id });
    expect(sent.status()).toBe(201);
    const mine = await rowsOf(email);
    expect(mine).toHaveLength(1);
    // There is no way to read feedback back.
    expect((await api(request, token, "get", "/feedback")).status()).toBe(405);
    // Its own limit: ten an hour.
    for (let i = 1; i < 10; i += 1)
      expect((await api(request, token, "post", "/feedback", body)).status()).toBe(201);
    expect((await api(request, token, "post", "/feedback", body)).status()).toBe(429);
    expect(await rowsOf(email)).toHaveLength(10);
  });

  test("the admin inbox: only for the CELLR admin, newest first, without names", async ({
    page,
    browser,
  }) => {
    // A tester sends one, and cannot open the inbox.
    const { email } = await arrive(page, "feedbacktester");
    const text = `Inbox check ${stamp()}: the 3D cellar stuttered when a bottle slid out.`;
    await api(page.request, await sessionToken(email), "post", "/feedback", {
      category: "bug",
      message: text,
      location: "cellar",
    });
    const denied = await page.goto("/admin/feedback");
    expect(denied?.status()).toBe(404);

    // The admin sees it.
    await sql("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [
      ADMIN_ID,
      ADMIN_EMAIL,
    ]);
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const admin = await context.newPage();
    await signIn(admin, ADMIN_EMAIL);
    await admin.goto("/admin/feedback?category=bug");
    await expect(admin.getByRole("heading", { level: 1, name: "Beta feedback" })).toBeVisible();
    const row = admin.getByRole("row").filter({ hasText: text });
    await expect(row).toContainText("Bug");
    await expect(row).toContainText("cellar");
    await expect(row).not.toContainText(email);
    await expect(
      admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Beta feedback" }),
    ).toBeVisible();
    await context.close();
  });
});
