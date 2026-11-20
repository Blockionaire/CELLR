/**
 * PAID MODEL CALLS IN THE BENCHMARK: OFF UNLESS THE OWNER SAID YES.
 *
 * The benchmark calls no model by default. One engine (`v1-ai`, Sommelier V1 with its AI) needs the paid model
 * to be measured at all. It can be run in two ways:
 *
 *   --estimate   No request leaves this machine. The prompts V1 would send are built by the app's own code and
 *                counted, and the cost is estimated high from the app's own price list.
 *   (for real)   Only with BOTH `SOMMELIER_EVAL_PAID=owner-approved` and a key in `OPENAI_API_KEY`, and never
 *                past `--max-usd` (default 2): the run stops the moment the measured spend reaches it.
 *
 * What is sent when it runs for real: the app's own sommelier prompt, a made-up cellar from fixtures.ts and a
 * question written for the benchmark. No person's data, no conversation anyone had, no account identifier.
 */
import { planCall } from "@/server/ai/models";
import { costOf, estimateCost } from "@/server/ai/pricing";
import type { AiResult, GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import type { AiEnv } from "@/server/env";

export const PAID_ENV = "SOMMELIER_EVAL_PAID";
export const PAID_PHRASE = "owner-approved";

/** Whether this run may spend money: the owner's phrase and a key, both. Anything else is a no. */
export const paidAllowed = (env: Record<string, string | undefined>): boolean =>
  env[PAID_ENV] === PAID_PHRASE && (env.OPENAI_API_KEY ?? "").trim() !== "";

export interface Meter {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usdMicro: number;
  /** Calls whose cost the provider did not report (a timeout, an error): counted at a high estimate. */
  unknownCost: number;
  /** The models the provider said answered, when it said so. */
  servedModels: Set<string>;
}
export const newMeter = (): Meter => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  usdMicro: 0,
  unknownCost: 0,
  servedModels: new Set(),
});

export class BudgetReached extends Error {
  constructor(readonly usdMicro: number) {
    super(`the benchmark's own spending limit was reached at $${(usdMicro / 1e6).toFixed(4)}`);
    this.name = "BudgetReached";
  }
}

/**
 * A provider that counts what is spent and refuses the next call once the limit is reached. The limit is checked
 * before each call, so the run can pass it by at most the one call that crossed it.
 */
export function metered(inner: LlmProvider, meter: Meter, maxUsdMicro: number): LlmProvider {
  return {
    async generateObject<T>(request: GenerateObjectRequest<T>): Promise<AiResult<T>> {
      if (meter.usdMicro >= maxUsdMicro) throw new BudgetReached(meter.usdMicro);
      const result = await inner.generateObject(request);
      meter.calls += 1;
      meter.inputTokens += result.usage.tokensIn;
      meter.outputTokens += result.usage.tokensOut;
      const cost = costOf(result.usage).usdMicro;
      if (cost === null) {
        // The provider did not say what this call used (a timeout, an error) or the model has no price here.
        // It still counts against the limit, at the app's own high estimate: unknown is never free.
        meter.unknownCost += 1;
        meter.usdMicro += estimateCost({
          model: result.usage.servedModel ?? result.usage.model,
          promptChars: request.system.length + request.user.length,
          images: 0,
          maxOutputTokens: request.maxOutputTokens,
          webSearch: false,
        });
      } else meter.usdMicro += cost;
      if (result.usage.servedModel) meter.servedModels.add(result.usage.servedModel);
      return result;
    },
  };
}

/**
 * A provider that sends nothing: it counts the prompt the app built and what the call could cost at most (the
 * app's own high estimate: ~3 characters a token, the full output allowance, one repair), then answers "no AI"
 * so the caller falls back, exactly as it does without a key.
 */
export function estimating(
  env: Pick<AiEnv, "visionModel" | "chatModel" | "adviceModel" | "reasoningEffort">,
  meter: Meter,
): LlmProvider {
  return {
    async generateObject<T>(request: GenerateObjectRequest<T>): Promise<AiResult<T>> {
      const plan = planCall(env, request);
      // The schema is sent with every call and counts as input too (for the dish reading it is the larger part).
      const promptChars =
        request.system.length + request.user.length + JSON.stringify(request.jsonSchema).length;
      meter.calls += 1;
      meter.inputTokens += Math.ceil(promptChars / 3);
      meter.outputTokens += plan.maxOutputTokens;
      meter.usdMicro += estimateCost({
        model: plan.model,
        promptChars,
        images: 0,
        maxOutputTokens: plan.maxOutputTokens,
        webSearch: false,
      });
      return {
        ok: false,
        kind: "unavailable",
        usage: { model: plan.model, tokensIn: 0, tokensOut: 0, latencyMs: 0, notSent: true },
      };
    },
  };
}
