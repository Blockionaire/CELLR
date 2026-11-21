import {
  detectIntent,
  type CellarItem,
  type CellarView,
  type Reservation,
  type TonightView,
} from "@cellr/domain";
import { aggregateInventory, buildTonight } from "@/server/cellar/service";
import { createSommelierService } from "@/server/sommelier/service";
import { guardShadow, type GuardShadow } from "@/server/sommelier/v1-guard";
import type { LlmProvider } from "@/server/ai/types";
import { buildFixture, NOW } from "../fixtures";
import type { Capability, Engine, EvalAnswer, Scenario, Verdict } from "../types";

/**
 * THE BASELINE: Sommelier V1 as it runs on `main` with no AI configured (the "basic" answers), called through the
 * app's own `createSommelierService`, `aggregateInventory` and `buildTonight`. Nothing is re-implemented here; the
 * only stand-ins are the database reads (a fixed cellar) and the clock.
 *
 * V1's AI path is not run: it needs the paid model, and no key is available to this benchmark (BASELINE.md says
 * what that leaves unmeasured). V1 states no verdict in a basic answer; the benchmark reads the strength of its
 * first pick as Tonight computes it (great or good → "good", worth-a-try → "acceptable"). It never says "none".
 */
const CAPABILITIES: ReadonlySet<Capability> = new Set(["pairing", "facts"]);

const LEVEL: Record<string, Verdict> = { great: "good", good: "good", "worth-a-try": "acceptable" };

/** What V1's AI calls its verdict, in the benchmark's words. */
const AI_VERDICT: Record<string, Verdict> = { match: "good", partial: "acceptable", none: "none" };

/** A model for one scenario, and what it used. Made by v1-ai.ts, which decides whether one may be called. */
export type ModelFor = () => { llm: LlmProvider; usage: () => NonNullable<EvalAnswer["ai"]> };

/**
 * Sommelier V1, without a model (`modelFor` null: the baseline) or with one (the `v1-ai` engine). With a model
 * the turns are asked one by one and its own earlier answers are sent along, as the screen does; without one
 * nothing changed.
 */
export function v1Engine(name: string, describes: string, modelFor: ModelFor | null): Engine {
  return {
    name,
    describes,
    capabilities: CAPABILITIES,
    run: (scenario) => runV1(scenario, modelFor?.() ?? null),
  };
}

async function runV1(scenario: Scenario, model: ReturnType<ModelFor> | null) {
  const missing = scenario.needs.filter((n) => !CAPABILITIES.has(n));
  // A scenario V1 cannot attempt is not asked of a paid model: it would be money spent on an answer that is
  // not counted.
  if (model && missing.length > 0)
    return {
      answer: {
        unsupported: missing,
        food: { legacy: null },
        verdict: null,
        bottles: [],
        invented: 0,
        flags: [],
        facts: null,
        confidence: null,
        buy: [],
      } satisfies EvalAnswer,
      ms: 0,
    };
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
  const cellar = (): CellarView => {
    const view = aggregateInventory(fixture.rows, favorites, scores, NOW);
    return {
      ...view,
      items: view.items.map((i): CellarItem => ({
        ...i,
        reserved: reservedOf.get(i.vintageId) ?? null,
      })),
    };
  };
  let tonight: TonightView | null = null;
  const service = createSommelierService({
    cellar: async () => cellar(),
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
    llm: model?.llm ?? null,
    spend: async () => {},
    householdId: async () => "00000000-0000-4000-8000-0000000000aa",
    locale: async () => scenario.lang,
    recordUsage: async () => {},
    // Variant E in shadow mode (S11): it changes nothing about the answer (v1-guard.test.ts), it is only heard.
    guard: guardShadow,
  });
  let shadow: GuardShadow | null = null;
  const observe = { guard: (g: GuardShadow) => (shadow = g) };
  const messages = scenario.turns.flatMap((t, i) =>
    i === scenario.turns.length - 1
      ? [{ role: "user" as const, text: t.user.slice(0, 800) }]
      : [
          { role: "user" as const, text: t.user.slice(0, 800) },
          { role: "assistant" as const, text: "…" },
        ],
  );
  const question = scenario.turns.at(-1)!.user;
  let started = performance.now();
  let answer = null as Awaited<ReturnType<typeof service.ask>> | null;
  if (model) {
    const said: Array<{ role: "user" | "assistant"; text: string }> = [];
    for (const turn of scenario.turns) {
      said.push({ role: "user", text: turn.user.slice(0, 800) });
      started = performance.now();
      shadow = null;
      answer = await service.ask({ messages: said.slice(-12), mode: "chat" }, observe);
      said.push({ role: "assistant", text: (answer.text ?? "…").slice(0, 2000) });
    }
  }
  answer ??= await service.ask({ messages: messages.slice(-12), mode: "chat" }, observe);
  const heard = shadow as GuardShadow | null;
  const ms = performance.now() - started;

  const seen = tonight as TonightView | null;
  const bottles = answer.bottles.map((b) => fixture.keyOfVintage.get(b.vintageId) ?? null);
  const offered = answer.bottles;
  const flags = new Set<string>();
  for (const b of offered) {
    if (b.reserved) flags.add("reserved");
    if (b.drinkPhase === "young") flags.add("young");
    if (b.drinkPhase === "past") flags.add("past");
  }
  const first = seen?.picks[0];
  const result: EvalAnswer = {
    ...(missing.length > 0 ? { unsupported: missing } : {}),
    food: { legacy: detectIntent(question).dish },
    verdict:
      answer.source === "ai"
        ? (AI_VERDICT[answer.verdict ?? ""] ?? null)
        : answer.basic === "pairing" && first && bottles.length > 0
          ? (LEVEL[first.match] ?? null)
          : null,
    bottles: bottles.filter((k): k is string => k !== null),
    invented: bottles.filter((k) => k === null).length,
    flags: [...flags],
    facts: answer.facts
      ? {
          bottles: answer.facts.bottles,
          wines: answer.facts.wines,
          ...(answer.facts.matchedBottles === undefined
            ? {}
            : { matchedBottles: answer.facts.matchedBottles }),
        }
      : null,
    confidence: null,
    buy: (answer.buy ?? []).map(() => ({
      style: null,
      minEuros: null,
      maxEuros: null,
      level: "style" as const,
    })),
  };
  result.guard = heard
    ? {
        considered: heard.considered,
        flagged: heard.flaggedIds.flatMap((id) => fixture.keyOfVintage.get(id) ?? []),
      }
    : null;
  if (model) result.ai = model.usage();
  return { answer: result, ms };
}

export const baseline: Engine = v1Engine(
  "v1-basic",
  "Sommelier V1 without AI (createSommelierService with llm = null): detectIntent → Tonight ranking → cards",
  null,
);
