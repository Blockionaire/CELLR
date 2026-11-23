import {
  detectIntent,
  parseSommelierParts,
  type CellarItem,
  type CellarView,
  type Reservation,
  type SommelierAnswer,
  type TonightView,
} from "@cellr/domain";
import { createOpenAiProvider } from "@/server/ai/openai";
import { priceOf } from "@/server/ai/pricing";
import type { AiResult, GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import { aggregateInventory, buildTonight } from "@/server/cellar/service";
import { getAiEnv } from "@/server/env";
import { createSommelierService } from "@/server/sommelier/service";
import {
  digestFromPrompt,
  factCodes,
  factsFromPrompt,
  flagged,
  refsAsAsked,
  removedSentences,
  renderRefs,
  sentencesOf,
  winesIn,
} from "../claims";
import { buildFixture, NOW } from "../fixtures";
import {
  estimating,
  metered,
  newMeter,
  PAID_ENV,
  PAID_PHRASE,
  paidAllowed,
  reservationFor,
  type Ledger,
  type Meter,
} from "../paid";
import type { SheetAnswer } from "../review-sheet";
import type { Capability, Engine, EvalAnswer, Scenario, Verdict } from "../types";
import { profileOf } from "./v3-app";

/**
 * SOMMELIER V1 WITH ITS MODEL, WITH A CHOSEN SET OF V1+ PARTS (P8 paid plan). The app's own service, prompt, schema
 * and checks, exactly as `v1-ai` (engines/baseline.ts) asks them, turn by turn, plus `parts` (CELLR_SOMMELIER):
 *
 *   --parts none     prompt v6, nothing checked: V1 as on `main` (the v6 side of the paired comparison)
 *   --parts check    prompt v7 and the check (the v7 side)
 *   --parts check,menu, ...
 *
 * The spending guard is paid.ts, unchanged: `--estimate` sends nothing; for real it needs SOMMELIER_EVAL_PAID=
 * owner-approved, a key, a priced model and a budget file, and reserves each call before it is sent (paidModel
 * below refuses exactly as v1-ai.ts does).
 *
 * Besides the benchmark's own scoring it records, per answer, what the check's rules flag in the model's words
 * (claims.ts: heuristics, not ground truth) on the raw text and on the text shown, whether the model wrote refs as
 * v7 asks, the check's outcome, every sentence removed or replaced, and the tokens of every call. The scenarios are
 * asked in the set's own order, so runs with different parts are paired scenario by scenario (compare.ts,
 * compare-claims.ts). The model is asked without a fixed seed or temperature (as the app asks it): runs differ, and
 * stats.ts averages them per scenario.
 */
const CAPABILITIES: ReadonlySet<Capability> = new Set(["pairing", "facts"]);
const LEVEL: Record<string, Verdict> = { great: "good", good: "good", "worth-a-try": "acceptable" };
const AI_VERDICT: Record<string, Verdict> = { match: "good", partial: "acceptable", none: "none" };

/** The model for a paid engine, behind paid.ts's guard; the refusals are v1-ai.ts's, word for word in substance. */
export function paidModel(options: {
  estimate: boolean;
  maxUsd: number;
  env?: Record<string, string | undefined>;
  provider?: LlmProvider;
  ledger?: Ledger | null;
  engine: string;
}): { llm: LlmProvider; meter: Meter; mode: "estimate" | "paid"; model: string } {
  const env = options.env ?? process.env;
  const ai = getAiEnv();
  const meter = newMeter();
  if (!options.estimate && !paidAllowed(env))
    throw new Error(
      `${options.engine} calls a paid model. Run it with --estimate (nothing is sent), or, with the owner's approval, with ${PAID_ENV}=${PAID_PHRASE} and OPENAI_API_KEY set.`,
    );
  if (!options.estimate && priceOf(ai.adviceModel) === null)
    throw new Error(
      `${options.engine} has no price for the model "${ai.adviceModel}" (apps/web/src/server/ai/pricing.ts), so it cannot keep to --max-usd. Add the price first, or run with --estimate.`,
    );
  if (!options.estimate && !options.ledger)
    throw new Error(
      `${options.engine} for real needs a total budget over all runs: --budget-file (outside the repository) and --total-usd.`,
    );
  const llm: LlmProvider = options.estimate
    ? estimating(ai, meter)
    : metered(
        options.provider ?? createOpenAiProvider({ ...ai, apiKey: env.OPENAI_API_KEY!.trim() }),
        meter,
        Math.round(options.maxUsd * 1e6),
        { reserve: (request) => reservationFor(ai, request), ledger: options.ledger ?? null },
      );
  return { llm, meter, mode: options.estimate ? "estimate" : "paid", model: ai.adviceModel };
}

/** One model call as the run saw it: what was sent (counted, never kept) and what it used. */
export interface CallRecord {
  promptChars: number;
  maxOutputTokens: number;
  tokensIn: number;
  tokensOut: number;
  /** The provider answered with a parsed answer. */
  ok: boolean;
}

/** What the run measured about one scenario's answers beyond the benchmark's scoring. */
export interface ClaimsRecord {
  /** The model's raw words (the last turn) had no flagged factual claim; null: no model answer. */
  rawClean: 0 | 1 | null;
  /** The words shown (the last turn) had none. */
  shownClean: 0 | 1 | null;
  /** Codes flagged, over every turn, in the raw words and in the words shown. */
  rawCodes: string[];
  shownCodes: string[];
  /** v7 only: every card of the last answer was written as its [[ref]]. */
  refsAsAsked: 0 | 1 | null;
  /** The check's outcome of the last answer; null without the part. */
  check: "kept" | "trimmed" | "replaced" | null;
  removed: number;
  calls: CallRecord[];
}

export interface V1PlusAiRun {
  engine: Engine;
  meter: Meter;
  mode: "estimate" | "paid";
  model: string;
  parts: string;
  /** By scenario id: the claims measured (merged into its vector by run.ts). */
  records: Map<string, ClaimsRecord>;
  /** Every answer's sentences, for the review sheets (readable sets only). */
  sheet: SheetAnswer[];
}

const label = (parts: string) => (parts === "" ? "none" : parts);

export function v1PlusAi(options: {
  estimate: boolean;
  maxUsd: number;
  /** A comma list of parts, as CELLR_SOMMELIER; "" or "none": V1 itself. */
  parts: string;
  env?: Record<string, string | undefined>;
  provider?: LlmProvider;
  ledger?: Ledger | null;
  /** The set's name, for the review sheet. */
  set?: string;
}): V1PlusAiRun {
  const parts = options.parts === "none" ? "" : options.parts;
  const parsed = parseSommelierParts(parts);
  if (parsed.unknown.length > 0)
    throw new Error(
      `unknown part(s): ${parsed.unknown.join(", ")} (known: check, annotate, quantities, menu, fallback)`,
    );
  const name = `v1plus-ai:${label(parts)}`;
  const paid = paidModel({ ...options, engine: "v1plus-ai" });
  const records = new Map<string, ClaimsRecord>();
  const sheet: SheetAnswer[] = [];
  const run: V1PlusAiRun = {
    engine: {
      name,
      describes:
        paid.mode === "estimate"
          ? `Sommelier V1 with AI and parts [${label(parts)}], ESTIMATE ONLY (no model was called; answers are V1's fallback): prompts for ${paid.model}`
          : `Sommelier V1 with AI and parts [${label(parts)}] (createSommelierService with the app's provider): ${paid.model}`,
      capabilities: CAPABILITIES,
      run: (scenario) =>
        runScenario(scenario, paid, parts, (record, answers) => {
          records.set(scenario.id, record);
          sheet.push(...answers.map((a) => ({ ...a, set: options.set ?? "?" })));
        }),
    },
    meter: paid.meter,
    mode: paid.mode,
    model: paid.model,
    parts: label(parts),
    records,
    sheet,
  };
  return run;
}

async function runScenario(
  scenario: Scenario,
  paid: ReturnType<typeof paidModel>,
  parts: string,
  keep: (record: ClaimsRecord, answers: SheetAnswer[]) => void,
) {
  const missing = scenario.needs.filter((n) => !CAPABILITIES.has(n));
  // Never a paid call for a scenario V1 cannot attempt (as v1-ai).
  if (missing.length > 0)
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
  const view = (): CellarView => {
    const v = aggregateInventory(fixture.rows, favorites, scores, NOW);
    return {
      ...v,
      items: v.items.map((i): CellarItem => ({
        ...i,
        reserved: reservedOf.get(i.vintageId) ?? null,
      })),
    };
  };
  const items = view().items;
  const profiles = new Map(
    fixture.wines.filter((f) => f.profiled).map((f) => [f.vintageId, profileOf(f)]),
  );
  // The call as the run saw it: counted, and the raw words kept for the measurement (never written for a blind set).
  let last: { request: GenerateObjectRequest<unknown>; raw: string | null } | null = null;
  const calls: CallRecord[] = [];
  const watched: LlmProvider = {
    async generateObject<T>(request: GenerateObjectRequest<T>): Promise<AiResult<T>> {
      const result = await paid.llm.generateObject(request);
      const value = result.ok ? (result.value as { raw?: { answer?: unknown } }) : null;
      last = {
        request: request as GenerateObjectRequest<unknown>,
        raw: typeof value?.raw?.answer === "string" ? value.raw.answer : null,
      };
      calls.push({
        promptChars:
          request.system.length + request.user.length + JSON.stringify(request.jsonSchema).length,
        maxOutputTokens: request.maxOutputTokens,
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
        ok: result.ok,
      });
      return result;
    },
  };
  const before = { ...paid.meter };
  let tonight: TonightView | null = null;
  const service = createSommelierService({
    cellar: async () => view(),
    storage: async () => [],
    racks: async () => ({ units: [], unplaced: [] }),
    tonight: async (request, taste) => {
      const v = buildTonight(fixture.rows, favorites, scores, request, NOW, taste ?? null);
      tonight = {
        ...v,
        picks: v.picks.map((p) => ({ ...p, reserved: reservedOf.get(p.vintageId) ?? null })),
      };
      return tonight;
    },
    llm: watched,
    parts: parseSommelierParts(parts),
    profiles: async (ids) =>
      new Map(ids.flatMap((id) => (profiles.has(id) ? [[id, profiles.get(id)!] as const] : []))),
    now: () => NOW,
    spend: async () => {},
    householdId: async () => "00000000-0000-4000-8000-0000000000aa",
    locale: async () => scenario.lang,
    recordUsage: async () => {},
  });
  const said: Array<{ role: "user" | "assistant"; text: string }> = [];
  const rawCodes = new Set<string>();
  const shownCodes = new Set<string>();
  const sheet: SheetAnswer[] = [];
  let answer: SommelierAnswer | null = null;
  let record: Omit<ClaimsRecord, "rawCodes" | "shownCodes" | "calls" | "removed"> = {
    rawClean: null,
    shownClean: null,
    refsAsAsked: null,
    check: null,
  };
  let removed = 0;
  let started = performance.now();
  for (const [t, turn] of scenario.turns.entries()) {
    said.push({ role: "user", text: turn.user.slice(0, 800) });
    last = null;
    started = performance.now();
    answer = await service.ask({ messages: said.slice(-12), mode: "chat" });
    said.push({ role: "assistant", text: (answer.text ?? "…").slice(0, 2000) });
    const seen = last as { request: GenerateObjectRequest<unknown>; raw: string | null } | null;
    if (!seen || seen.raw === null || answer.source !== "ai") {
      record = { rawClean: null, shownClean: null, refsAsAsked: null, check: null };
      continue;
    }
    const on = {
      digest: digestFromPrompt(seen.request.user, items),
      items,
      facts: factsFromPrompt(seen.request.user),
      now: NOW,
    };
    const raw = factCodes(flagged(seen.raw, answer.bottles, on));
    const shown = factCodes(flagged(answer.text ?? "", answer.bottles, on));
    raw.forEach((c) => rawCodes.add(c));
    shown.forEach((c) => shownCodes.add(c));
    const v7 = !JSON.stringify(seen.request.jsonSchema).includes('"price"');
    const outcome = answer.check?.text ?? null;
    const rendered = renderRefs(seen.raw, on.digest);
    const gone = removedSentences(rendered, answer.text, outcome);
    removed += gone.length;
    const goneSet = new Set(gone.map((g) => g.sentence));
    sheet.push({
      run: "",
      set: "",
      scenario: scenario.id,
      turn: t + 1,
      question: turn.user,
      cards: answer.bottles.map((b) => `${b.producer} ${b.wineName}${b.year ? ` ${b.year}` : ""}`),
      removed: gone.map((g) => ({
        ...g,
        codes: flagged(g.sentence, answer!.bottles, on),
        wines: winesIn(g.sentence, items),
      })),
      kept: sentencesOf(rendered)
        .filter((s) => !goneSet.has(s))
        .map((sentence) => ({ sentence, wines: winesIn(sentence, items) })),
    });
    const cardIds = answer.bottles.map((b) => b.vintageId);
    const asAsked = v7 ? refsAsAsked(seen.raw, cardIds, on.digest) : null;
    record = {
      rawClean: raw.length === 0 ? 1 : 0,
      shownClean: shown.length === 0 ? 1 : 0,
      refsAsAsked: asAsked === null ? null : asAsked ? 1 : 0,
      check: outcome,
    };
  }
  const ms = performance.now() - started;
  keep(
    {
      ...record,
      rawCodes: [...rawCodes].sort(),
      shownCodes: [...shownCodes].sort(),
      removed,
      calls,
    },
    sheet,
  );

  const final = answer!;
  const seenTonight = tonight as TonightView | null;
  const bottles = final.bottles.map((b) => fixture.keyOfVintage.get(b.vintageId) ?? null);
  const flags = new Set<string>();
  for (const b of final.bottles) {
    if (b.reserved) flags.add("reserved");
    if (b.drinkPhase === "young") flags.add("young");
    if (b.drinkPhase === "past") flags.add("past");
  }
  const first = seenTonight?.picks[0];
  const question = scenario.turns.at(-1)!.user;
  const result: EvalAnswer = {
    food: { legacy: detectIntent(question).dish },
    verdict:
      final.source === "ai"
        ? (AI_VERDICT[final.verdict ?? ""] ?? null)
        : final.basic === "pairing" && first && bottles.length > 0
          ? (LEVEL[first.match] ?? null)
          : null,
    bottles: bottles.filter((k): k is string => k !== null),
    invented: bottles.filter((k) => k === null).length,
    flags: [...flags],
    facts: final.facts
      ? {
          bottles: final.facts.bottles,
          wines: final.facts.wines,
          ...(final.facts.matchedBottles === undefined
            ? {}
            : { matchedBottles: final.facts.matchedBottles }),
        }
      : null,
    confidence: null,
    buy: (final.buy ?? []).map(() => ({
      style: null,
      minEuros: null,
      maxEuros: null,
      level: "style" as const,
    })),
    ai: {
      calls: paid.meter.calls - before.calls,
      inputTokens: paid.meter.inputTokens - before.inputTokens,
      outputTokens: paid.meter.outputTokens - before.outputTokens,
      usdMicro: paid.meter.usdMicro - before.usdMicro,
    },
  };
  return { answer: result, ms };
}
