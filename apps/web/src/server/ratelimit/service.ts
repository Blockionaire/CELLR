import "server-only";
import { DomainError } from "@cellr/domain";
import type { RateLimitRepository } from "./repository";

export interface RateLimit {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

/** Well-known limits live here so every endpoint spends from the same, reviewable budget. */
export const LIMITS = {
  events: { bucket: "events", limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimit>;

export function createRateLimiter(repo: RateLimitRepository) {
  return {
    /** Counts this call, or throws RATE_LIMITED (retryable) when the budget is spent. */
    async enforce({ bucket, limit, windowSeconds }: RateLimit): Promise<void> {
      if (!(await repo.consume(bucket, limit, windowSeconds))) {
        throw new DomainError("RATE_LIMITED", undefined, { retryable: true });
      }
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
