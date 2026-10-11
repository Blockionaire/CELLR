import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const STACK = "http://localhost:54321";
export const PUBLISHABLE_KEY = "sb_publishable_localstack_0000000000";

/** A fresh, never-before-seen address on the allowed test domain. */
export const uniqueEmail = (label = "user") =>
  `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}@example.test`;

/** Reads the one-time code the way a person would read it from their inbox. */
export async function codeFor(email: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const { code } = (await (
      await fetch(`${STACK}/__test/otp?email=${encodeURIComponent(email)}`)
    ).json()) as { code: string | null };
    if (code) return code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No sign-in code was issued for ${email}`);
}

/** Runs SQL against the local database (test fixture only). */
export async function sql<T = Record<string, unknown>>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await fetch(`${STACK}/__test/sql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql: query, params }),
  });
  if (!res.ok) throw new Error(`SQL failed: ${await res.text()}`);
  return ((await res.json()) as { rows: T[] }).rows;
}

/** Signs in through the real UI: email → code from the "inbox" → typed into the app. */
export async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.getByLabel("6-digit code").fill(await codeFor(email));
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
}

/** First-run: create a household, then give your name. Ends on Home. */
export async function onboardCreate(page: Page, household: string, name: string) {
  await expect(page.getByRole("heading", { name: "Who shares this cellar?" })).toBeVisible();
  await page.getByLabel("Household name").fill(household);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page.getByRole("heading", { name: "What should we call you?" })).toBeVisible();
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Let's go" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

/** Signs in over HTTP only (what a native app does) and returns its access token. */
export async function sessionToken(email: string): Promise<string> {
  await fetch(`${STACK}/auth/v1/otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, create_user: true }),
  });
  const res = await fetch(`${STACK}/auth/v1/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, token: await codeFor(email), type: "email" }),
  });
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error(`Could not sign ${email} in: ${JSON.stringify(body)}`);
  return body.access_token;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export async function api(
  request: APIRequestContext,
  token: string,
  method: "get" | "post" | "patch" | "delete" | "put",
  path: string,
  data?: unknown,
) {
  return request[method](`/api/v1${path}`, {
    headers: bearer(token),
    ...(data === undefined ? {} : { data }),
  });
}
