import "server-only";
import type { AiEnv, ReasoningEffort } from "@/server/env";
import type { GenerateObjectRequest } from "./types";

/**
 * Which model answers a call, and how it is asked. Shared by the provider and the platform budget, so the
 * budget always estimates the call that is actually made.
 *
 * - Label scanning: the vision model (AI_MODEL_VISION). Web-search valuations: the chat model (AI_MODEL_CHAT).
 * - Sommelier, Tonight and wine profiles (with or without their web research): the advice model
 *   (AI_MODEL_ADVICE), the chat model when unset.
 *
 * Reasoning parameters are sent only to models listed in REASONING, with only the efforts their official model
 * page documents. Every other model (GPT-4.1, GPT-4.1-mini, anything not listed) is asked exactly as before: no
 * reasoning parameter. At "none" a listed model takes temperature like GPT-4.x; at any other effort temperature
 * is left out (the provider refuses it then) and the output limit gets room for reasoning, billed as output.
 */
export interface CallPlan {
  model: string;
  /** Null for a model not listed in REASONING: no reasoning parameter is sent at all. */
  reasoningEffort: ReasoningEffort | null;
  /** The output limit sent to the provider: the request's own, plus room for reasoning when it thinks. */
  maxOutputTokens: number;
  /** The request's temperature, unless reasoning is on. */
  temperature: number | undefined;
}

const ADVICE_TASKS = new Set(["sommelier_chat", "wine_insight"]);

/**
 * The reasoning efforts each model accepts (of the ones CELLR uses), from OpenAI's model pages, checked
 * 2026-10-25. gpt-6-luna: none, low, medium (also high, xhigh, max; not used here). A model missing here gets
 * no reasoning parameter; add it only from its own documentation.
 */
const REASONING: Record<string, readonly ReasoningEffort[]> = {
  "gpt-6-luna": ["none", "low", "medium"],
};

/** Reasoning tokens count against the same output limit, so a thinking model gets this much extra. */
const REASONING_ROOM: Record<ReasoningEffort, number> = { none: 0, low: 2000, medium: 6000 };

/** The efforts a model accepts, by its id or dated snapshot ("gpt-6-luna-2026-09-22"); null if not listed. */
export function reasoningEfforts(model: string): readonly ReasoningEffort[] | null {
  return REASONING[model] ?? REASONING[model.replace(/-\d{4}-\d{2}-\d{2}$/, "")] ?? null;
}

/**
 * The effort a call is sent with. A web search thinks at least "low": searching and weighing sources is
 * reasoning work, and "none" with built-in tools is not documented for every model. An effort the model does not
 * accept is never sent; the nearest one it does accept is used instead.
 */
function effortFor(
  efforts: readonly ReasoningEffort[],
  wanted: ReasoningEffort,
  webSearch: boolean,
): ReasoningEffort {
  const order: ReasoningEffort[] = ["none", "low", "medium"];
  const floor = webSearch ? Math.max(order.indexOf(wanted), 1) : order.indexOf(wanted);
  return order.slice(floor).find((e) => efforts.includes(e)) ?? efforts[efforts.length - 1]!;
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
      : ADVICE_TASKS.has(request.task)
        ? env.adviceModel
        : env.chatModel;
  const efforts = reasoningEfforts(model);
  const reasoningEffort = efforts
    ? effortFor(efforts, env.reasoningEffort, request.webSearch === true)
    : null;
  const thinks = reasoningEffort !== null && reasoningEffort !== "none";
  return {
    model,
    reasoningEffort,
    maxOutputTokens: request.maxOutputTokens + (thinks ? REASONING_ROOM[reasoningEffort] : 0),
    temperature: thinks ? undefined : request.temperature,
  };
}
