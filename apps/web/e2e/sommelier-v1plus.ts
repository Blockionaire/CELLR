import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { apiClient, bearer, sql, STACK } from "./helpers";

/**
 * Shared by the Sommelier V1+ specs (sommelier-check, -cards, -menu, -fallback, -journey): a small real cellar, the
 * programmable model of the local stack, and the two ways of asking (through the screen, and straight at one of the
 * servers). The parts are switched on only on the features server (playwright.config.ts, CELLR_SOMMELIER); the
 * default server is V1 as it was, and several specs ask both to prove exactly that.
 */

export const DEFAULT_URL = "http://localhost:3100";

type Call = Awaited<ReturnType<typeof apiClient>>["call"];

export const CELLAR = [
  {
    producer: "Château Margaux",
    name: "Pavillon Rouge",
    type: "red",
    countryCode: "FR",
    region: "Bordeaux",
    year: 2015,
    quantity: 3,
  },
  {
    producer: "Bollinger",
    name: "Special Cuvée",
    type: "sparkling",
    countryCode: "FR",
    region: "Champagne",
    year: null,
    quantity: 2,
  },
  {
    producer: "Antinori",
    name: "Tignanello",
    type: "red",
    countryCode: "IT",
    region: "Tuscany",
    year: 2018,
    quantity: 6,
  },
  {
    producer: "Domaine Weinbach",
    name: "Riesling Schlossberg",
    type: "white",
    countryCode: "FR",
    region: "Alsace",
    year: 2020,
    quantity: 1,
  },
] as const;

/** Puts the cellar above in one fridge; returns each wine's vintage id by its name. */
export async function furnish(call: Call) {
  const fridge = (
    await call("post", "/storage", { label: "Wine fridge", kind: "fridge", rows: 4, cols: 6 }, 201)
  ).body as { id: string };
  for (const { year, quantity, ...wine } of CELLAR) {
    const w = (await call("post", "/wines", wine, 201)).body as { id: string };
    await call("post", "/bottles", { wineId: w.id, year, quantity, locationId: fridge.id }, 201);
  }
  const cellar = (
    await call<{ items: Array<{ vintageId: string; wineName: string }> }>(
      "get",
      "/cellar",
      undefined,
      200,
    )
  ).body;
  return Object.fromEntries(cellar.items.map((i) => [i.wineName, i.vintageId])) as Record<
    string,
    string
  >;
}

/** What the model is shown calls a wine by the first characters of its id. */
export const refOf = (vintageId: string) => vintageId.replace(/-/g, "").slice(0, 6);

/** Words that only this test's question contains: that is how the fake model knows which answer to give. */
export const marker = () =>
  `[${test.info().parallelIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}]`;

export async function program(
  match: string,
  plan: { content?: unknown; sequence?: unknown[]; status?: number },
) {
  const res = await fetch(`${STACK}/__test/openai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ match, ...plan }),
  });
  expect(res.ok).toBe(true);
}

export const modelCalls = async (match: string) =>
  (
    (await (
      await fetch(`${STACK}/__test/openai/calls?match=${encodeURIComponent(match)}`)
    ).json()) as {
      calls: Array<{ model: string; system: string; user: string; strict: boolean }>;
    }
  ).calls;

/** Asks one of the servers directly, as the signed-in person. */
export async function askAt(
  request: APIRequestContext,
  base: string,
  token: string,
  messages: Array<{ role: "user" | "assistant"; text: string }> | string,
  extra: Record<string, unknown> = {},
) {
  const res = await request.post(`${base}/api/v1/sommelier`, {
    headers: bearer(token),
    data: {
      messages: typeof messages === "string" ? [{ role: "user", text: messages }] : messages,
      ...extra,
    },
  });
  expect(res.status(), `${base}: ${JSON.stringify(messages).slice(0, 120)}`).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

/** Asks through the screen. */
export async function ask(
  page: Page,
  text: string,
  labels = { question: "Your question", send: "Send" },
) {
  await page.getByLabel(labels.question).fill(text);
  await page.getByRole("button", { name: labels.send }).click();
}
export const DUTCH = { question: "Je vraag", send: "Verstuur" };

/** The person's app language. */
export async function setLocale(email: string, locale: "en" | "nl") {
  await sql(
    "update public.profiles set locale = $2 where id = (select id from auth.users where email = $1)",
    [email, locale],
  );
}

/** Nothing on the page is wider than the screen (a phone's 390 px, or narrower when the test sets it). */
export async function expectNoSidewaysScroll(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

/**
 * What V1 itself decided in an answer: where it came from, the wines and their order, the verdict. A V1+ part may
 * add its own facts around these, never change them; comparing them between the default and the features server
 * stays true whichever other parts are on there.
 */
export const chosen = (answer: Record<string, unknown>) => ({
  source: answer.source,
  basic: answer.basic,
  reason: answer.reason,
  verdict: answer.verdict ?? null,
  bottles: answer.bottles,
});
