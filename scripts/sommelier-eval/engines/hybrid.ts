import type { DishReading } from "@cellr/domain/intelligence";
import { createOpenAiProvider } from "@/server/ai/openai";
import { priceOf } from "@/server/ai/pricing";
import type { LlmProvider } from "@/server/ai/types";
import { getAiEnv } from "@/server/env";
import { createMemoryDishCache } from "@/server/sommelier/dish-cache";
import { createDishReader } from "@/server/sommelier/dish-reader";
import { createPairingReviewer } from "@/server/sommelier/pairing-reviewer";
import {
  estimating,
  metered,
  newMeter,
  PAID_ENV,
  PAID_PHRASE,
  paidAllowed,
  type Meter,
} from "../paid";
import { anyCard } from "../sets";
import type { Engine, EvalAnswer, Scenario } from "../types";
import { makeV3App } from "./v3-app";

/**
 * THE HYBRID VARIANTS OF S10, on exactly the scenarios and the scorer of the other engines.
 *
 * - `v3-oracle` (free): the dish reader is the reference card itself, for the dishes the router sends to a
 *   reader. An upper bound: what the engines would give if every routed dish were read perfectly. It reads the
 *   card's class and scales only, never its wine labels.
 * - `v3-hybrid` (C, paid): the app's own dish reader with the app's model; the engines decide.
 * - `v3-hybrid-review` (D, paid, an experiment): C, and the app's second opinion on close calls.
 *
 * C and D call a paid model: as v1-ai, they estimate by default and run for real only with the owner's phrase and
 * a key (paid.ts). Each run has one shared dish store, as one server instance would.
 */
const oracleReaderFor = (scenario: Scenario) => {
  const card = scenario.dish ? anyCard(scenario.dish) : null;
  if (!card) return null;
  const t = card.truth;
  return async (): Promise<DishReading> => ({
    recognised: true,
    main: t.main,
    mainIngredient: null,
    ingredients: [],
    techniques: [],
    sauces: [],
    structure: {
      weight: t.weight,
      fat: t.fat,
      acid: t.acid,
      sweet: t.sweet,
      heat: t.heat,
      umami: t.umami,
    },
    tags: [],
    confidence: "high",
    dropped: 0,
  });
};

export const v3Oracle: Engine = makeV3App({
  name: "v3-oracle",
  describes:
    "Sommelier 3.0 with a perfect dish reader for the dishes the router sends on (the reference card's class and scales): an upper bound, not a product",
  readerFor: oracleReaderFor,
});

export interface HybridRun {
  engines: { c: Engine; d: Engine };
  meter: Meter;
  mode: "estimate" | "paid";
  model: string;
  /** How the dish readings were come by, over the run. */
  readings: Record<"cache" | "model" | "failed" | "limited", number>;
}

export function hybrid(options: {
  estimate: boolean;
  maxUsd: number;
  env?: Record<string, string | undefined>;
  provider?: LlmProvider;
}): HybridRun {
  const env = options.env ?? process.env;
  const ai = getAiEnv();
  const meter = newMeter();
  if (!options.estimate && !paidAllowed(env))
    throw new Error(
      `v3-hybrid calls a paid model. Run it with --estimate (nothing is sent), or, with the owner's approval, with ${PAID_ENV}=${PAID_PHRASE} and OPENAI_API_KEY set.`,
    );
  if (!options.estimate && priceOf(ai.adviceModel) === null)
    throw new Error(
      `v3-hybrid has no price for the model "${ai.adviceModel}", so it cannot keep to --max-usd. Add the price first, or run with --estimate.`,
    );
  const llm: LlmProvider = options.estimate
    ? estimating(ai, meter)
    : metered(
        options.provider ?? createOpenAiProvider({ ...ai, apiKey: env.OPENAI_API_KEY!.trim() }),
        meter,
        Math.round(options.maxUsd * 1e6),
      );
  const readings = { cache: 0, model: 0, failed: 0, limited: 0 };
  const cache = createMemoryDishCache();
  const reader = createDishReader({
    llm,
    model: ai.adviceModel,
    spend: async () => {},
    householdId: async () => null,
    recordUsage: async () => {},
    cache,
    observe: (how) => (readings[how] += 1),
  });
  const reviewer = createPairingReviewer({
    llm,
    spend: async () => {},
    householdId: async () => null,
    recordUsage: async () => {},
  });
  let before = { ...meter };
  const usage = (): NonNullable<EvalAnswer["ai"]> => ({
    calls: meter.calls - before.calls,
    inputTokens: meter.inputTokens - before.inputTokens,
    outputTokens: meter.outputTokens - before.outputTokens,
    usdMicro: meter.usdMicro - before.usdMicro,
  });
  const begin = () => {
    before = { ...meter };
  };
  const tag = options.estimate
    ? "ESTIMATE ONLY (no model was called; answers are the parser's)"
    : ai.adviceModel;
  return {
    engines: {
      c: makeV3App({
        name: "v3-hybrid",
        describes: `Sommelier 3.0 with the model reading dishes the parser could not place (C): ${tag}`,
        readerFor: () => reader,
        usage,
        begin,
      }),
      d: makeV3App({
        name: "v3-hybrid-review",
        describes: `Sommelier 3.0 with the model's dish reading and its second opinion on close calls (D): ${tag}`,
        readerFor: () => reader,
        reviewFor: () => reviewer,
        usage,
        begin,
      }),
    },
    meter,
    mode: options.estimate ? "estimate" : "paid",
    model: ai.adviceModel,
    readings,
  };
}
