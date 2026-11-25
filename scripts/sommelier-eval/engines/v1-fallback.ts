import {
  detectIntent,
  wantsSomethingDifferent,
  type AskSommelier,
  type CellarItem,
  type CellarView,
  type Reservation,
  type SommelierAnswer,
  type TonightView,
} from "@cellr/domain";
import { FOOD, WINE_KNOWLEDGE, parseFood, readWine } from "@cellr/domain/intelligence";
import { aggregateInventory, buildTonight } from "@/server/cellar/service";
import { createSommelierIntelligence, profileFacts } from "@/server/sommelier/intelligence";
import { createSommelierFallback } from "@/server/sommelier/parts/fallback";
import { createSommelierService } from "@/server/sommelier/service";
import { buildFixture, NOW } from "../fixtures";
import type { Capability, Engine, EvalAnswer, Scenario, Verdict } from "../types";
import { truthOf } from "./v3";
import { profileOf } from "./v3-app";

/**
 * SOMMELIER V1 WITHOUT ITS MODEL, WITH THE `fallback` PART ON (P7): what the service will do once the part is wired.
 * Where V1 answers with `plain()` today, it first asks the fallback (`createSommelierFallback`, the engines built
 * without buying advice and without a retailer source); when that declines, the app's own plain answer is given,
 * through `createSommelierService` with `llm: null` exactly as `v1-basic` runs it. Everything is the app's own
 * code; the stand-ins are the database reads (the fixed cellar, its reservations and profiles) and the clock.
 *
 * Every turn of a conversation is answered this way (no model is there for any of them), and the state of an
 * answer that has a plan is sent back with the next question, as the screen does. Which answer is drawn is what the
 * person would see: the plan's picks when the fallback answered, V1's cards otherwise.
 *
 * `v1-fallback-plain` is the same with a plan that is only a question back left to the plain answer instead: it
 * exists to measure that choice (fallback.ts), not to be shipped.
 */
const CAPABILITIES: ReadonlySet<Capability> = new Set([
  "pairing",
  "facts",
  "evidence",
  "conversation",
]);

/** What a plain answer's first pick means as a verdict (the same reading as `v1-basic`). */
const LEVEL: Record<string, Verdict> = { great: "good", good: "good", "worth-a-try": "acceptable" };

function fallbackEngine(name: string, describes: string, clarify: "ask" | "plain"): Engine {
  return {
    name,
    describes,
    capabilities: CAPABILITIES,
    run: (scenario) => runFallback(scenario, clarify),
  };
}

async function runFallback(scenario: Scenario, clarify: "ask" | "plain") {
  const missing = scenario.needs.filter((n) => !CAPABILITIES.has(n));
  const fixture = buildFixture(scenario);
  const favorites = new Set(fixture.wines.filter((f) => f.favorite).map((f) => f.wineId));
  const scores = fixture.wines
    .filter((f) => f.rating !== null)
    .map((f) => ({ vintageId: f.vintageId, score: f.rating! }));
  const reservedOf = new Map<string, Reservation>(
    fixture.wines
      .filter((f) => f.reserved > 0)
      .map((f) => [f.vintageId, { count: f.reserved, title: "Benchmark occasion", on: null }]),
  );
  const cellar = async (): Promise<CellarView> => {
    const view = aggregateInventory(fixture.rows, favorites, scores, NOW);
    return {
      ...view,
      items: view.items.map((i): CellarItem => ({
        ...i,
        reserved: reservedOf.get(i.vintageId) ?? null,
      })),
    };
  };
  const profiles = new Map(
    fixture.wines.filter((f) => f.profiled).map((f) => [f.vintageId, profileOf(f)]),
  );
  const fallback = createSommelierFallback(
    {
      intelligence: createSommelierIntelligence({
        cellar,
        profiles: async () => profiles,
        taste: async () => null,
        offers: null,
        buying: false,
        now: () => NOW,
      }),
      spend: async () => {},
    },
    { clarify },
  );
  let tonight: TonightView | null = null;
  const service = createSommelierService({
    cellar,
    storage: async () => [],
    racks: async () => ({ units: [], unplaced: [] }),
    tonight: async (request, taste) => {
      const view = buildTonight(fixture.rows, favorites, scores, request, NOW, taste ?? null);
      tonight = {
        ...view,
        picks: view.picks.map((p) => ({ ...p, reserved: reservedOf.get(p.vintageId) ?? null })),
      };
      return tonight;
    },
    llm: null,
    spend: async () => {},
    householdId: async () => "00000000-0000-4000-8000-0000000000aa",
    locale: async () => scenario.lang,
    recordUsage: async () => {},
  });

  let state: unknown = undefined;
  let answer: SommelierAnswer | null = null;
  let ms = 0;
  const said: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (const turn of scenario.turns) {
    said.push({ role: "user", text: turn.user.slice(0, 800) });
    const request: AskSommelier = {
      messages: said.slice(-12),
      mode: "chat",
      state,
      ...(turn.budgetEuros === undefined ? {} : { budgetEuros: turn.budgetEuros }),
    };
    tonight = null;
    // Timed as one answer: the cellar read, the fallback, and the plain answer when it declines.
    const started = performance.now();
    const { items } = await cellar();
    const question = turn.user.slice(0, 800);
    answer =
      (await fallback({
        request,
        items,
        reason: "ai-off",
        personal: request.personal !== false && !wantsSomethingDifferent(question),
        locale: scenario.lang,
      })) ?? (await service.ask(request));
    ms = performance.now() - started;
    state = answer.plan?.state;
    said.push({ role: "assistant", text: "…" });
  }
  const last = answer!;
  const plan = last.plan ?? null;
  const question = scenario.turns.at(-1)!.user;
  const keyOf = (vintageId: string) => fixture.keyOfVintage.get(vintageId) ?? null;
  const offered = plan ? plan.picks.map((p) => p.vintageId) : last.bottles.map((b) => b.vintageId);
  const keys = offered.map(keyOf);

  const flags = new Set<string>();
  if (plan) {
    // As `v3-app` reads a plan.
    for (const pick of plan.picks)
      for (const note of pick.notes) {
        if (note === "partly-reserved") flags.add("reserved");
        if (note === "young" || note === "past") flags.add(note);
        if (note === "may-be-past") flags.add("past");
        if (note === "estimate" || note === "by-name") flags.add("estimate");
        if (note === "little-known") flags.add("unknown-data");
      }
    for (const aside of plan.setAside)
      flags.add(
        aside.reason === "too-young"
          ? "young"
          : aside.reason === "reserved"
            ? "reserved"
            : "turned-down",
      );
    if (plan.closest?.notes.includes("past")) flags.add("past");
  } else {
    // As `v1-basic` reads a plain answer.
    for (const b of last.bottles) {
      if (b.reserved) flags.add("reserved");
      if (b.drinkPhase === "young") flags.add("young");
      if (b.drinkPhase === "past") flags.add("past");
    }
  }
  const seen = tonight as TonightView | null;
  const first = seen?.picks[0];
  const result: EvalAnswer = {
    ...(missing.length > 0 ? { unsupported: missing } : {}),
    food: plan
      ? {
          truth: truthOf(
            ((f) => (f.main === null && plan.dish ? parseFood(plan.dish, FOOD) : f))(
              parseFood(question, FOOD),
            ),
          ),
        }
      : { legacy: detectIntent(question).dish },
    verdict: plan
      ? (plan.outcome ?? null)
      : last.basic === "pairing" && first && keys.length > 0
        ? (LEVEL[first.match] ?? null)
        : null,
    bottles: keys.filter((k): k is string => k !== null),
    invented: keys.filter((k) => k === null).length,
    flags: [...flags],
    facts: last.facts
      ? {
          bottles: last.facts.bottles,
          wines: last.facts.wines,
          ...(last.facts.matchedBottles === undefined
            ? {}
            : { matchedBottles: last.facts.matchedBottles }),
        }
      : null,
    confidence: plan?.confidence ?? null,
    ...(plan
      ? {
          tiers: Object.fromEntries(
            fixture.wines.map((f) => [
              f.key,
              readWine(
                {
                  type: f.wine.type,
                  name: f.wine.name,
                  region: f.stripped ? null : f.wine.region,
                  appellation: f.stripped ? null : f.wine.appellation,
                  countryCode: f.stripped ? null : f.wine.countryCode,
                  profile: f.profiled ? profileFacts(profileOf(f)) : null,
                },
                WINE_KNOWLEDGE,
              ).tier,
            ]),
          ),
        }
      : {}),
    // Never a price and never a style: the fallback gives no buying advice, and a plain answer none either.
    buy: [
      ...(plan?.styles ?? []).map((s) => ({
        style: s.styleId,
        minEuros: s.fromEuros,
        maxEuros: null,
        level: "style" as const,
      })),
      ...(last.buy ?? []).map(() => ({
        style: null,
        minEuros: null,
        maxEuros: null,
        level: "style" as const,
      })),
    ],
    state: plan
      ? { ...plan.state, asked: null, rejected: null, offered: null, recipientLikes: null }
      : {},
    asks: plan?.ask ?? null,
  };
  return { answer: result, ms };
}

export const v1Fallback: Engine = fallbackEngine(
  "v1-fallback",
  "Sommelier V1 without AI, fallback part on: createSommelierFallback (engines' plan, no buying advice), else plain() via createSommelierService with llm = null",
  "ask",
);

export const v1FallbackPlain: Engine = fallbackEngine(
  "v1-fallback-plain",
  "As v1-fallback, but a plan that only asks a question back is left to the plain answer (measures that choice)",
  "plain",
);
