import "server-only";
import type { TrackEvent } from "@cellr/domain";
import { LIMITS, type RateLimiter } from "@/server/ratelimit/service";
import type { AnalyticsRepository } from "./repository";

export function createAnalyticsService(repo: AnalyticsRepository, limiter: RateLimiter) {
  return {
    /** Rate-limited so a bug (or a bored teenager) cannot fill the table. */
    async track(event: TrackEvent): Promise<void> {
      await limiter.enforce(LIMITS.events);
      await repo.record(event);
    },
  };
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;
