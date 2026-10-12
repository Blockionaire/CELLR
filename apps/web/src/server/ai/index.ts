import "server-only";
import { getAiEnv } from "@/server/env";
import { createOpenAiProvider } from "./openai";
import type { LlmProvider } from "./types";

/** The configured AI, or null when there is no key: callers then take their plain, no-AI path. */
export function getLlmProvider(): LlmProvider | null {
  const env = getAiEnv();
  return env.apiKey ? createOpenAiProvider({ ...env, apiKey: env.apiKey }) : null;
}

export type { AiErrorKind, AiResult, AiUsage, LlmProvider } from "./types";
