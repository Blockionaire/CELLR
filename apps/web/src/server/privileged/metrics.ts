import "server-only";
import {
  derivePlatformMetrics,
  RawPlatformMetricsSchema,
  type PlatformMetrics,
} from "@cellr/domain";
import { createServiceClient } from "./client";

/**
 * Platform-wide metrics (every household), counted by public.platform_metrics() with the service role. For
 * internal use only: never call this from anything a signed-in person can reach without an admin check.
 * Null when the service role is not configured.
 */
export async function getPlatformMetrics(now = new Date()): Promise<PlatformMetrics | null> {
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await db.rpc("platform_metrics", { p_now: now.toISOString() });
  if (error) throw error;
  return derivePlatformMetrics(RawPlatformMetricsSchema.parse(data));
}
