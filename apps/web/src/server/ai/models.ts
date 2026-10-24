import "server-only";
import type { AiEnv, ReasoningEffort } from "@/server/env";
import type { GenerateObjectRequest } from "./types";

/**
 * Which model answers a call, and how it is asked. Shared by the provider and the platform budget, so the
 * budget always estimates the call that is actually made.
 *
 * - Label scanning: the vision model. Web-search valuations: the chat model. Both unchanged.
 * - Sommelier and wine profiles: the advice model (AI_MODEL_ADVICE), which defaults to the chat model, so
 *   nothing changes until it is set; unsetting it is the rollback.
 *
 * Reasoning models (GPT-5 and later, o-series) get a reasoning effort. At "none" they behave like a GPT-4.x
 * model (temperature allowed, no hidden thinking). Any other effort drops temperature (the provider refuses
 * it then) and leaves room in the token limit for the reasoning, which is billed as output.
 */
export interface CallPlan {
  model: string;
  /** Null for a model without reasoning (GPT-4.x): no reasoning parameter is sent at all. */
  reasoningEffort: ReasoningEffort | null;
  /** The output limit sent to the provider: the request's own, plus room for reasoning when it thinks. */
  maxOutputTokens: number;
  /** The request's temperature, unless reasoning is on. */
  temperature: number | undefined;
}

const ADVICE_TASKS = new Set(["sommelier_chat", "wine_insight"]);

/** Reasoning tokens count against the same output limit, so a thinking model gets this much extra. */
const REASONING_ROOM: Record<ReasoningEffort, number> = { none: 0, low: 2000, medium: 6000 };

export function isReasoningModel(model: string): boolean {
  return /^(gpt-([5-9]|\d{2,})|o\d)/.test(model);
}

export function planCall(
  env: Pick<AiEnv, "visionModel" | "chatModel" | "adviceModel" | "reasoningEffort">,
  request: Pick<
    GenerateObjectRequest<unknown>,
    "model" | "task" | "webSearch" | "maxOutputTokens" | "temperature"
  >,
): CallPlan {
  const model =
    request.model === "vision"
      ? env.visionModel
      : ADVICE_TASKS.has(request.task) && !request.webSearch
        ? env.adviceModel
        : env.chatModel;
  const reasoningEffort = isReasoningModel(model) ? env.reasoningEffort : null;
  const thinks = reasoningEffort !== null && reasoningEffort !== "none";
  return {
    model,
    reasoningEffort,
    maxOutputTokens: request.maxOutputTokens + (thinks ? REASONING_ROOM[reasoningEffort] : 0),
    temperature: thinks ? undefined : request.temperature,
  };
}
