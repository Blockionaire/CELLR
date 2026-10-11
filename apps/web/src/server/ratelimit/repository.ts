import "server-only";
import type { Db } from "@/server/db/clients";
import { mapDbError } from "@/server/db/errors";

export interface RateLimitRepository {
  /** True when the call is allowed (and has been counted); false when the limit is already reached. */
  consume(bucket: string, limit: number, windowSeconds: number): Promise<boolean>;
}

/** Sliding-window limiter kept in Postgres (no Redis at this scale). Per user, per named bucket. */
export function createRateLimitRepository(db: Db): RateLimitRepository {
  return {
    async consume(bucket, limit, windowSeconds) {
      const { data, error } = await db.rpc("consume_rate_limit", {
        p_bucket: bucket,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      if (error) throw mapDbError(error);
      return data;
    },
  };
}
