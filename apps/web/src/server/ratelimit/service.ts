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
  /** Photos take storage and, for scans, money: a generous but finite budget. */
  uploads: { bucket: "uploads", limit: 60, windowSeconds: 3600 },
  /** A conversation costs money too: a long evening of questions is fine, a script is not. */
  chat: { bucket: "chat", limit: 60, windowSeconds: 3600 },
  /** A full copy of the household's data is a big read: plenty for a person, not for a loop. */
  export: { bucket: "export", limit: 10, windowSeconds: 3600 },
  /** Every label read costs money: a person scanning a whole case is fine, a script is not. */
  scans: { bucket: "scans", limit: 40, windowSeconds: 3600 },
  /** A wine profile costs a call each; a person going through a cellar is fine, a loop is not. */
  insights: { bucket: "insights", limit: 40, windowSeconds: 3600 },
  /** A price lookup searches the web and costs the most; once a month per wine is the rule anyway. */
  valuations: { bucket: "valuations", limit: 30, windowSeconds: 3600 },
  /** Bringing a whole cellar in is heavy and rarely needed more than once. */
  import: { bucket: "import", limit: 6, windowSeconds: 3600 },
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
