import "server-only";
import { DomainError } from "@cellr/domain";
import type { PairingReview, ReviewInput } from "@cellr/domain/intelligence";
import {
  PAIRING_REVIEW_SYSTEM,
  pairingReviewRequest,
  pairingReviewUserMessage,
} from "@/server/ai/prompts/pairing-review";
import type { AiErrorKind, AiUsage, LlmProvider } from "@/server/ai/types";

/**
 * A MODEL'S SECOND OPINION IN A CLOSE CALL (S10, an experiment behind `sommelier_second_opinion`). It sees the dish
 * as the engine read it and the engine's own picks as styles; its answer can only keep, reorder or drop those
 * picks. Any failure gives null and the engine's picks stand.
 */
export interface PairingReviewerDeps {
  llm: LlmProvider;
  spend: () => Promise<void>;
  householdId: () => Promise<string | null>;
  recordUsage: (entry: {
    householdId: string | null;
    task: string;
    status: "ok" | "error" | "timeout" | "invalid_output" | "rate_limited" | "budget_exhausted";
    usage: AiUsage;
  }) => Promise<void>;
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

export function createPairingReviewer(deps: PairingReviewerDeps) {
  return async (input: ReviewInput, refs: string[]): Promise<PairingReview | null> => {
    if (refs.length === 0) return null;
    try {
      await deps.spend();
    } catch (error) {
      if (error instanceof DomainError && error.code === "RATE_LIMITED") return null;
      throw error;
    }
    const { schema, parse } = pairingReviewRequest(refs);
    const result = await deps.llm.generateObject({
      task: "pairing_review",
      model: "chat",
      system: PAIRING_REVIEW_SYSTEM,
      user: pairingReviewUserMessage(input),
      schemaName: "pairing_review",
      jsonSchema: schema,
      parse,
      maxOutputTokens: 200,
      timeoutMs: 15_000,
      temperature: 0,
    });
    await deps
      .recordUsage({
        householdId: await deps.householdId().catch(() => null),
        task: "pairing_review",
        status: result.ok ? "ok" : STATUS[result.kind],
        usage: result.usage,
      })
      .catch(() => {});
    return result.ok ? result.value : null;
  };
}
