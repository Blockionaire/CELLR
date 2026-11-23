import { expect, test } from "@playwright/test";
import { apiClient, arrive, audit, FEATURES_URL, sql } from "./helpers";
import {
  ask,
  askAt,
  DEFAULT_URL,
  DUTCH,
  expectNoSidewaysScroll,
  furnish,
  marker,
  modelCalls,
  program,
  setLocale,
} from "./sommelier-v1plus";

/**
 * Sommelier V1+, P7: the `fallback` part (docs/sprints/sommelier-3-mega/SOMMELIER_CLOSEOUT.md §6, D-49). On the
 * features server (CELLR_SOMMELIER names it) a question V1 cannot put to its model is answered by the engines'
 * plan, with the reason said and never a price. A model that answers is never replaced, a question of fact stays
 * counted, and the default server (the part off, as production is) answers exactly as it did.
 */

test.use({ baseURL: FEATURES_URL });

const shot = (name: string) => `test-results/shots/${name}-${test.info().project.name}.png`;
const DOWN_EN =
  "The sommelier couldn’t be reached just now, so this answer comes straight from your cellar.";
const DOWN_NL =
  "De sommelier was nu niet bereikbaar, dus dit antwoord komt rechtstreeks uit je kelder.";
const LIMIT_EN =
  "You have asked a lot in a short while, so this answer comes straight from your cellar.";

test.describe("the sommelier's fallback (CELLR_SOMMELIER=fallback)", () => {
  test("the model is down: the engines' plan answers with real bottles, says why, and names no price", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "fbdown");
    const { call } = await apiClient(request, email);
    await furnish(call);
    const m = marker();
    await program(m, { status: 500 });
    await page.goto("/sommelier");
    await ask(page, `What goes with a grilled steak? ${m}`);
    const log = page.getByRole("log", { name: "Conversation" });
    const plan = log.getByTestId("plan");
    await expect(plan).toBeVisible();
    // The engines decided: a red for the steak, as a card of a bottle that is really there.
    await expect(
      log
        .getByTestId("plan-picks")
        .getByRole("link", { name: /Pavillon Rouge|Tignanello/ })
        .first(),
    ).toBeVisible();
    await expect(log.getByTestId("answer-reason")).toHaveText(DOWN_EN);
    // Never a price, a style to buy or an offer: buying advice is not part of the fallback.
    await expect(log.getByTestId("plan-buy")).toHaveCount(0);
    await expect(log).not.toContainText("€");
    // The model was asked once, and not again.
    expect(await modelCalls(m)).toHaveLength(1);
    await expectNoSidewaysScroll(page);
    expect(await audit(page)).toEqual([]);
    await page.screenshot({ path: shot("v1plus-fallback"), fullPage: true });

    // The answer is kept with its reason: it is there, drawn the same, after a reload.
    await page.reload();
    await expect(page.getByRole("log", { name: "Conversation" }).getByTestId("plan")).toBeVisible();
    await expect(
      page.getByRole("log", { name: "Conversation" }).getByTestId("answer-reason"),
    ).toHaveText(DOWN_EN);
  });

  test("in Dutch on a small phone: the same plan, the reason in Dutch, nothing wider than the screen", async ({
    page,
    request,
    isMobile,
  }) => {
    if (isMobile) await page.setViewportSize({ width: 360, height: 740 });
    const { email } = await arrive(page, "fbnl");
    const { call } = await apiClient(request, email);
    await furnish(call);
    await setLocale(email, "nl");
    const m = marker();
    await program(m, { status: 500 });
    await page.goto("/sommelier");
    await ask(page, `Wat schenk ik bij een gegrilde biefstuk? ${m}`, DUTCH);
    const log = page.getByRole("log", { name: "Gesprek" });
    await expect(log.getByTestId("plan")).toBeVisible();
    await expect(
      log
        .getByTestId("plan-picks")
        .getByRole("link", { name: /Pavillon Rouge|Tignanello/ })
        .first(),
    ).toBeVisible();
    await expect(log.getByTestId("answer-reason")).toHaveText(DOWN_NL);
    await expectNoSidewaysScroll(page);
    await page.screenshot({ path: shot("v1plus-fallback-nl-small"), fullPage: true });
  });

  test("the person's limit is spent: the engines answer, the model is not asked", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "fblimit");
    const { call } = await apiClient(request, email);
    await furnish(call);
    const [user] = await sql<{ id: string }>("select id from auth.users where email = $1", [email]);
    await sql(
      "insert into private.rate_events (user_id, bucket) select $1, 'app:chat' from generate_series(1, 60)",
      [user!.id],
    );
    const m = marker();
    await program(m, { content: { answer: "Should not be heard.", bottle_refs: [] } });
    await page.goto("/sommelier");
    await ask(page, `What goes with oysters? ${m}`);
    const log = page.getByRole("log", { name: "Conversation" });
    await expect(log.getByTestId("plan")).toBeVisible();
    await expect(log.getByTestId("answer-reason")).toHaveText(LIMIT_EN);
    expect(await modelCalls(m)).toHaveLength(0);
  });
});

test.describe("the fallback and V1 (API)", () => {
  test.skip(({ isMobile }) => isMobile, "an API comparison: the screen does not take part");

  test("only without a model answer, never for a question of fact, and not at all with the part off", async ({
    page,
    request,
  }) => {
    const { email } = await arrive(page, "fbapi");
    const { call, token } = await apiClient(request, email);
    await furnish(call);

    // The model down, the same question to both servers.
    const down = marker();
    await program(down, { status: 500 });
    const question = `What goes with a grilled steak? ${down}`;
    const v1 = await askAt(request, DEFAULT_URL, token, question);
    const plus = await askAt(request, FEATURES_URL, token, question);
    // Production's configuration: the plain answer, exactly as before (no plan).
    expect(v1).toMatchObject({ source: "basic", basic: "pairing", reason: "ai-down" });
    expect(v1.plan ?? null).toBeNull();
    // The part on: the engines' plan, the same reason, and nothing to buy.
    expect(plus).toMatchObject({ source: "basic", reason: "ai-down" });
    const plan = plus.plan as {
      kind: string;
      picks: unknown[];
      styles: unknown[];
      offers: unknown[];
    };
    expect(plan.kind).toBe("pairing");
    expect(plan.picks.length).toBeGreaterThan(0);
    expect(plan.styles).toEqual([]);
    expect(plan.offers).toEqual([]);
    expect(JSON.stringify(plus)).not.toContain("€");

    // A model that answers is V1's answer on both: the engines are not consulted.
    const up = marker();
    await program(up, { content: { answer: "Open the Pavillon Rouge.", bottle_refs: [] } });
    const answered = await askAt(request, FEATURES_URL, token, `What goes with a steak? ${up}`);
    expect(answered).toMatchObject({
      source: "ai",
      text: "Open the Pavillon Rouge.",
      reason: null,
    });
    expect(answered.plan ?? null).toBeNull();
    expect(await modelCalls(up)).toHaveLength(1);

    // A question of fact stays counted, on both servers alike, with the model down.
    const fact = marker();
    await program(fact, { status: 500 });
    const counted = await Promise.all(
      [DEFAULT_URL, FEATURES_URL].map((base) =>
        askAt(request, base, token, `How many bottles of Tignanello do I have? ${fact}`),
      ),
    );
    expect(counted[0]).toMatchObject({ basic: "facts" });
    expect(counted[1]).toEqual(counted[0]);

    // A general question about wine is not the engines': the plain answer, as on the default server.
    const general = marker();
    await program(general, { status: 500 });
    const plain = await Promise.all(
      [DEFAULT_URL, FEATURES_URL].map((base) =>
        askAt(
          request,
          base,
          token,
          `What is the difference between Barolo and Barbaresco? ${general}`,
        ),
      ),
    );
    expect(plain[1]).toEqual(plain[0]);
  });
});
