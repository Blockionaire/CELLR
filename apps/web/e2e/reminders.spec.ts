import { createECDH, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { apiClient, arrive, sql, STACK, wineBody } from "./helpers";

// The same secret the test server is started with (playwright.config.ts).
const CRON_SECRET = "local-stack-cron";
const PUSH_SERVICE = "https://localhost:54331";

/** What a browser hands over when it allows notifications: real keys, an endpoint at the fake push service. */
function phone() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const id = randomUUID();
  return {
    id,
    subscription: {
      endpoint: `${PUSH_SERVICE}/push/${id}`,
      keys: {
        p256dh: ecdh.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
      },
    },
  };
}

const pushed = async (id: string) =>
  ((await (await fetch(`${STACK}/__test/push/calls?id=${id}`)).json()) as { calls: unknown[] })
    .calls;

const runRound = (request: APIRequestContext, secret = CRON_SECRET) =>
  request.get("/api/cron/drink-reminders", { headers: { authorization: `Bearer ${secret}` } });

/**
 * A window (whole years, like the AI gives) whose best years began within the last few weeks, wherever in the
 * year the tests run: they start a quarter into the window, so a span of 20 + 4q years starts them at year + q.
 */
function peakingNow() {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3) * 0.25;
  const from = now.getUTCFullYear() - 5;
  return { from, until: from + 20 + 4 * q };
}

/** A wine in the cellar whose AI window puts it where we want, bought long before. */
async function wineAt(
  call: Awaited<ReturnType<typeof apiClient>>["call"],
  householdId: string,
  name: string,
  window: { from: number; until: number },
) {
  const wine = (await call<{ id: string }>("post", "/wines", { ...wineBody, name }, 201)).body;
  await call(
    "post",
    "/bottles",
    { wineId: wine.id, year: 2015, quantity: 1, locationId: null },
    201,
  );
  const [v] = await sql<{ id: string }>("select id from public.wine_vintages where wine_id = $1", [
    wine.id,
  ]);
  await sql("update public.bottles set created_at = '2012-01-01' where vintage_id = $1", [v!.id]);
  const output = {
    summary: "A test wine.",
    style: "",
    grapes: [],
    tasting: "",
    serving: null,
    decantMinutes: null,
    abvPercent: null,
    drinkWindow: window,
    pairings: [],
    aging: "",
    value: null,
    confidence: "medium",
  };
  await sql(
    `insert into public.vintage_insights (household_id, vintage_id, output, model, generated_at)
     values ($1, $2, $3::jsonb, 'test', now())`,
    [householdId, v!.id, JSON.stringify(output)],
  );
  return v!.id;
}

test.describe("reminders when a wine is at its best", () => {
  test("switch them on for a phone; the daily round tells each moment once, and forgets a phone that is gone", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const { email, householdId } = await arrive(page, "remind");
    const { call } = await apiClient(request, email);

    const status = await call<{ enabled: boolean; publicKey: string }>(
      "get",
      "/push",
      undefined,
      200,
    );
    expect(status.body.enabled).toBe(true);
    expect(status.body.publicKey).toMatch(/^[\w-]{80,}$/);

    // Only real push services (https) are accepted.
    const p = phone();
    await call("post", "/push", { ...p.subscription, endpoint: "http://evil.example/x" }, 422);
    await call("post", "/push", p.subscription, 200);
    await call("post", "/push", p.subscription, 200); // twice is fine

    // Reached its best years this month, long after it was bought: news.
    const peaking = await wineAt(call, householdId, "Now peaking", peakingNow());
    // At its best for years already: old news, kept quiet (and remembered as known).
    const old = await wineAt(call, householdId, "Long peaking", { from: 2000, until: 2060 });

    expect((await runRound(request, "wrong")).status()).toBe(401);
    const round = await runRound(request);
    expect(round.status()).toBe(200);
    expect(((await round.json()) as { notified: number }).notified).toBeGreaterThanOrEqual(1);

    const calls = await pushed(p.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ encoding: "aes128gcm", vapid: true });
    const told = await sql<{ vintage_id: string; kind: string }>(
      "select vintage_id, kind from public.drink_notices n join public.push_subscriptions s using (user_id) where s.endpoint = $1 order by kind",
      [p.subscription.endpoint],
    );
    expect(told).toEqual(
      expect.arrayContaining([
        { vintage_id: peaking, kind: "peak" },
        { vintage_id: old, kind: "peak" },
      ]),
    );

    // The next day: nothing new, nothing sent.
    await runRound(request);
    expect(await pushed(p.id)).toHaveLength(1);

    // The phone is gone (app removed): the next reminder finds out and forgets it. (2000–2030 → last stretch.)
    await fetch(`${STACK}/__test/push/gone`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: p.id }),
    });
    await wineAt(call, householdId, "Also peaking", peakingNow());
    await runRound(request);
    expect(
      await sql("select 1 from public.push_subscriptions where endpoint = $1", [
        p.subscription.endpoint,
      ]),
    ).toHaveLength(0);
  });

  test("a phone is personal: another person can neither see nor switch it off", async ({
    page,
    request,
    browser,
  }) => {
    const one = await arrive(page, "remindone");
    const { call } = await apiClient(request, one.email);
    const p = phone();
    await call("post", "/push", p.subscription, 200);

    const other = await browser.newPage();
    const two = await arrive(other, "remindtwo");
    const { call: call2 } = await apiClient(request, two.email);
    await call2(
      "delete",
      `/push?endpoint=${encodeURIComponent(p.subscription.endpoint)}`,
      undefined,
      200,
    );
    expect(
      await sql("select 1 from public.push_subscriptions where endpoint = $1", [
        p.subscription.endpoint,
      ]),
    ).toHaveLength(1);
    await other.close();
  });

  test("the profile offers to switch them on", async ({ page }) => {
    await arrive(page, "remindui");
    await page.goto("/profile");
    const section = page.getByTestId("reminders");
    await expect(section.getByRole("heading", { name: "Reminders" })).toBeVisible();
    await expect(section.getByRole("button", { name: "Turn on for this phone" })).toBeVisible({
      timeout: 10_000,
    });
  });
});
