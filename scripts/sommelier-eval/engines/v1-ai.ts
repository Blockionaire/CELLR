import { createOpenAiProvider } from "@/server/ai/openai";
import { priceOf } from "@/server/ai/pricing";
import type { LlmProvider } from "@/server/ai/types";
import { getAiEnv } from "@/server/env";
import {
  estimating,
  metered,
  newMeter,
  PAID_ENV,
  PAID_PHRASE,
  paidAllowed,
  type Meter,
} from "../paid";
import type { Engine, EvalAnswer } from "../types";
import { v1Engine } from "./baseline";

/**
 * SOMMELIER V1 WITH ITS AI: what people get today when a key is configured. The app's own service, prompt,
 * schema and answer check; only the cellar (fixtures.ts) and the clock are stand-ins.
 *
 * It costs money to run, so it is not one of the engines a plain `pnpm sommelier:eval` knows. `run.ts` builds it
 * only when asked for by name, and then either as an estimate (nothing is sent) or for real (paid.ts says when
 * that is allowed). The model is the one the app is configured with (AI_MODEL_ADVICE, else AI_MODEL_CHAT), asked
 * the way the app asks it.
 */
export interface V1AiRun {
  engine: Engine;
  meter: Meter;
  mode: "estimate" | "paid";
  model: string;
}

export function v1Ai(options: {
  estimate: boolean;
  maxUsd: number;
  env?: Record<string, string | undefined>;
  /** For tests: the provider to use instead of the real one. */
  provider?: LlmProvider;
}): V1AiRun {
  const env = options.env ?? process.env;
  const ai = getAiEnv();
  const meter = newMeter();
  if (!options.estimate && !paidAllowed(env))
    throw new Error(
      `v1-ai calls a paid model. Run it with --estimate (nothing is sent), or, with the owner's approval, with ${PAID_ENV}=${PAID_PHRASE} and OPENAI_API_KEY set.`,
    );
  // A model the app has no price for cannot be held to a spending limit: its calls would count as nothing.
  if (!options.estimate && priceOf(ai.adviceModel) === null)
    throw new Error(
      `v1-ai has no price for the model "${ai.adviceModel}" (apps/web/src/server/ai/pricing.ts), so it cannot keep to --max-usd. Add the price first, or run with --estimate.`,
    );
  const llm: LlmProvider = options.estimate
    ? estimating(ai, meter)
    : metered(
        options.provider ?? createOpenAiProvider({ ...ai, apiKey: env.OPENAI_API_KEY!.trim() }),
        meter,
        Math.round(options.maxUsd * 1e6),
      );
  const modelFor = () => {
    const before = { ...meter };
    return {
      llm,
      usage: (): NonNullable<EvalAnswer["ai"]> => ({
        calls: meter.calls - before.calls,
        inputTokens: meter.inputTokens - before.inputTokens,
        outputTokens: meter.outputTokens - before.outputTokens,
        usdMicro: meter.usdMicro - before.usdMicro,
      }),
    };
  };
  return {
    engine: v1Engine(
      "v1-ai",
      options.estimate
        ? `Sommelier V1 with AI, ESTIMATE ONLY (no model was called; answers are V1's fallback): prompts for ${ai.adviceModel}`
        : `Sommelier V1 with AI (createSommelierService with the app's provider): ${ai.adviceModel}, reasoning ${ai.reasoningEffort}`,
      modelFor,
    ),
    meter,
    mode: options.estimate ? "estimate" : "paid",
    model: ai.adviceModel,
  };
}
