import "server-only";
import { DomainError } from "@cellr/domain";
import type { DishReading } from "@cellr/domain/intelligence";
import {
  DISH_READING_PROMPT_VERSION,
  DISH_READING_SYSTEM,
  dishReadingSchema,
  dishReadingUserMessage,
  parseDishReading,
} from "@/server/ai/prompts/dish-reading";
import type { AiErrorKind, AiUsage, LlmProvider } from "@/server/ai/types";
import { dishCacheKey, type DishReadingCache } from "./dish-cache";

/**
 * THE MODEL READS A DISH (S10, switch `sommelier_dish_ai`). Called by the engines only for a dish the food parser
 * shows it may have misread (`routeDishReading`), with the dish phrase alone (`dishPhrase`): no question, no
 * conversation, no name, no cellar. The answer is the engine's own dish profile, checked against the knowledge;
 * any failure (no key, the platform budget, the person's limit, a timeout, an answer outside the schema) gives
 * null, and the engines go on with the parser's reading, as they do without this switch.
 */
export interface DishReaderDeps {
  llm: LlmProvider;
  /** The model the provider will be asked with, for the cache key (a new model is a new key). */
  model: string;
  /** Spends from the person's own limit for model calls; throws RATE_LIMITED when it is gone. */
  spend: () => Promise<void>;
  householdId: () => Promise<string | null>;
  recordUsage: (entry: {
    householdId: string | null;
    task: string;
    status: "ok" | "error" | "timeout" | "invalid_output" | "rate_limited" | "budget_exhausted";
    usage: AiUsage;
  }) => Promise<void>;
  cache?: DishReadingCache | null;
  /** Hears how each reading was come by (for metrics and the benchmark); never the phrase. */
  observe?: (how: "cache" | "model" | "failed" | "limited") => void;
}

const STATUS: Record<
  AiErrorKind,
  "error" | "timeout" | "invalid_output" | "rate_limited" | "budget_exhausted"
> = {
  unavailable: "error",
  refused: "error",
  timeout: "timeout",
  invalid: "invalid_output",
  rate_limited: "rate_limited",
  budget: "budget_exhausted",
};

export function createDishReader(deps: DishReaderDeps) {
  return async (phrase: string): Promise<DishReading | null> => {
    const key = dishCacheKey(phrase, deps.model, DISH_READING_PROMPT_VERSION);
    const kept = deps.cache?.get(key) ?? null;
    if (kept) {
      deps.observe?.("cache");
      return kept;
    }
    try {
      await deps.spend();
    } catch (error) {
      if (error instanceof DomainError && error.code === "RATE_LIMITED") {
        deps.observe?.("limited");
        return null;
      }
      throw error;
    }
    const result = await deps.llm.generateObject({
      task: "dish_reading",
      model: "chat",
      system: DISH_READING_SYSTEM,
      user: dishReadingUserMessage(phrase),
      schemaName: "dish_reading",
      jsonSchema: dishReadingSchema(),
      parse: parseDishReading,
      maxOutputTokens: 400,
      timeoutMs: 15_000,
      temperature: 0,
    });
    await deps
      .recordUsage({
        householdId: await deps.householdId().catch(() => null),
        task: "dish_reading",
        status: result.ok ? "ok" : STATUS[result.kind],
        usage: result.usage,
      })
      .catch(() => {});
    if (!result.ok) {
      deps.observe?.("failed");
      return null;
    }
    deps.cache?.set(key, result.value);
    deps.observe?.("model");
    return result.value;
  };
}

export type DishReader = ReturnType<typeof createDishReader>;
