import "server-only";
import { DomainError, SubmitFeedbackSchema, type SubmitFeedback } from "@cellr/domain";
import type { FeedbackRepository } from "./types";

/**
 * Beta feedback from the signed-in person: checked, counted against its own rate limit, and stored for them.
 * No AI is involved and nothing beyond what they typed and chose to include is kept.
 */
export function createFeedbackService(deps: {
  repo: FeedbackRepository;
  /** Spends from the feedback limit; throws RATE_LIMITED when it is gone. */
  spend: () => Promise<void>;
}) {
  return {
    async submit(input: SubmitFeedback): Promise<{ ok: true }> {
      const parsed = SubmitFeedbackSchema.safeParse(input);
      if (!parsed.success) throw new DomainError("VALIDATION");
      await deps.spend();
      if (!(await deps.repo.add(parsed.data)))
        throw new DomainError("INTERNAL", "Feedback needs one more database step first.");
      return { ok: true };
    },
  };
}

export type FeedbackService = ReturnType<typeof createFeedbackService>;
