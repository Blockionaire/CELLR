import AxeBuilder from "@axe-core/playwright";
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

export const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/** WCAG 2.1 AA violations on the current page, as readable one-liners (empty = clean). */
export async function audit(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.length}) — ${v.nodes[0]?.target.join(" ")}`,
  );
}

/** A signed-in person with a household, ready to use the cellar. */
export async function arrive(page: Page, label: string) {
  const email = uniqueEmail(label);
  const household = `House ${stamp()}`;
  await signIn(page, email);
  await onboardCreate(page, household, "Joost");
  const [row] = await sql<{ id: string }>("select id from public.households where name = $1", [
    household,
  ]);
  return { email, household, householdId: row!.id };
}

export const wineBody = {
  producer: "Domaine Test",
  name: "Chablis Premier Cru",
  type: "white",
  countryCode: "FR",
  region: "Burgundy",
};

/** What a native app would do: sign in over HTTP and call the API with a bearer token. */
export async function apiClient(request: APIRequestContext, email: string) {
  const token = await sessionToken(email);
  const call = async <T = Record<string, unknown>>(
    method: "get" | "post" | "patch" | "put" | "delete",
    path: string,
    data?: unknown,
    expected?: number,
  ) => {
    const res = await api(request, token, method, path, data);
    if (expected !== undefined) expect(res.status(), `${method} ${path}`).toBe(expected);
    return { status: res.status(), body: (await res.json().catch(() => null)) as T };
  };
  return { token, call };
}

/**
 * A real, decodable JPEG, drawn in the browser (the test machine has no image tools): a wine-coloured
 * "label" with the given words on it. `exif` hides a position and a camera serial in the file, the way a
 * phone does, so tests can prove they do not survive an upload.
 */
export async function makeJpeg(
  page: Page,
  options: { width?: number; height?: number; words?: string; exif?: boolean; color?: string } = {},
): Promise<Buffer> {
  const {
    width = 600,
    height = 800,
    words = "Test Label",
    exif = false,
    color = "#7d2234",
  } = options;
  const base64 = await page.evaluate(
    ([w, h, text, fill]) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#f4ecd8";
      ctx.fillRect(w * 0.1, h * 0.12, w * 0.8, h * 0.76);
      ctx.fillStyle = "#2a1e19";
      ctx.font = `${Math.round(w / 10)}px serif`;
      ctx.textAlign = "center";
      ctx.fillText(text, w / 2, h / 2);
      return canvas.toDataURL("image/jpeg", 0.9).split(",")[1]!;
    },
    [width, height, words, color] as const,
  );
  const jpeg = Buffer.from(base64, "base64");
  if (!exif) return jpeg;
  const body = Buffer.from("Exif\0\0GPS 52.3676N 4.9041E SerialNumber 0042", "latin1");
  const segment = Buffer.concat([
    Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]),
    body,
  ]);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}
