import "server-only";
import { getAiEnv } from "@/server/env";
import { holdAiBudget } from "@/server/privileged/ai-budget";
import { withBudget } from "./budget";
import { createOpenAiProvider } from "./openai";
import type { LlmProvider } from "./types";

/**
 * The configured AI, or null when there is no key: callers then take their plain, no-AI path. Every call goes
 * through the platform-wide budget (a no-op when no budget is configured).
 */
export function getLlmProvider(): LlmProvider | null {
  const env = getAiEnv();
  if (!env.apiKey) return null;
  return withBudget(
    createOpenAiProvider({ ...env, apiKey: env.apiKey }),
    (request) => (request.model === "vision" ? env.visionModel : env.chatModel),
    holdAiBudget,
  );
}

export type { AiErrorKind, AiResult, AiUsage, LlmProvider } from "./types";
