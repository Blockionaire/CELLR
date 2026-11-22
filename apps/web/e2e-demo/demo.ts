import { expect, type Page } from "@playwright/test";

export const READONLY_URL = process.env.DEMO_READONLY_URL || "http://localhost:3201";
export const CODE = process.env.DEMO_FIXED_OTP || "246810";
export const OWNER = "owner@demo.cellr.test";

/** Signs in with the demo's fixed code (demo addresses only), skipping the PIN offer. */
export async function signInDemo(page: Page, email = OWNER, base = "") {
  await page.goto(`${base}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.getByLabel("6-digit code").fill(CODE);
  await page.waitForFunction(
    () =>
      !location.pathname.startsWith("/sign-in") ||
      document.querySelector('[data-testid="pin-offer"]') !== null,
  );
  if (new URL(page.url()).pathname.startsWith("/sign-in"))
    await page.getByTestId("pin-offer").getByRole("button", { name: "Not now" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
}

/** The 3D cellar, drawn. */
export async function open3D(page: Page, base = "") {
  await page.goto(`${base}/cellar`);
  await page.getByRole("radio", { name: "3D" }).click();
  await expect(page.getByTestId("smart-3d")).toHaveAttribute("data-mode", "ready");
}

export const drawn = (page: Page) =>
  expect(page.getByTestId("smart-3d-stage").locator("canvas[data-engine]")).toHaveAttribute(
    "data-frames",
    /^[1-9]/,
    { timeout: 90_000 },
  );

export const STACK_URL = process.env.DEMO_STACK_URL || "http://localhost:54321";
export const APP_URL = process.env.DEMO_URL || "http://localhost:3200";

/** A token for a demo address, through the local stack's (fake) Auth and the demo's fixed code. */
export async function tokenFor(email: string): Promise<string> {
  const json = { "content-type": "application/json" };
  await fetch(`${STACK_URL}/auth/v1/otp`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email, create_user: true }),
  });
  const res = await fetch(`${STACK_URL}/auth/v1/verify`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email, token: CODE, type: "email" }),
  });
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error(`demo: could not sign ${email} in`);
  return body.access_token;
}

export type Api = <T = unknown>(
  method: string,
  path: string,
  data?: unknown,
  expected?: number,
) => Promise<{ status: number; body: T }>;

/** The app's own API (`/api/v1…`) as that person: the same authorization as the browser. */
export function apiAs(token: string, base = APP_URL): Api {
  return async (method, path, data, expected) => {
    const res = await fetch(`${base}/api/v1${path}`, {
      method: method.toUpperCase(),
      headers: {
        authorization: `Bearer ${token}`,
        ...(data === undefined ? {} : { "content-type": "application/json" }),
      },
      body: data === undefined ? null : JSON.stringify(data),
    });
    const body = await res.json().catch(() => null);
    if (expected !== undefined && res.status !== expected)
      throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(body)}`);
    return { status: res.status, body };
  };
}

/**
 * A NEW synthetic person with a household of their own (never the shared demo cellar, which stays as seeded):
 * `<label>-<time>@demo.cellr.test`. `node scripts/demo/seed.mjs --reset` removes them with the rest of the demo.
 */
export async function freshPerson(label: string, household = "Acceptance cellar") {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@demo.cellr.test`;
  const token = await tokenFor(email);
  const call = apiAs(token);
  const created = await call<{ id: string }>("post", "/households", { name: household }, 201);
  await call("patch", "/me", { displayName: "Acceptance tester" }, 200);
  return { email, token, call, householdId: created.body.id };
}
