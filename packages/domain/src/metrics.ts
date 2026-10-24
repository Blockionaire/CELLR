import { z } from "zod";

/**
 * Platform metrics as public.platform_metrics() counts them from the database (definitions: docs/METRICS.md),
 * plus the rates derived here. A rate is null when there is nothing to divide by: "insufficient data", never 0%.
 */
export const RawPlatformMetricsSchema = z.object({
  at: z.string(),
  registered: z.number().int().nonnegative(),
  new_7d: z.number().int().nonnegative(),
  new_30d: z.number().int().nonnegative(),
  dau: z.number().int().nonnegative(),
  wau: z.number().int().nonnegative(),
  mau: z.number().int().nonnegative(),
  onboarded: z.number().int().nonnegative(),
  activated: z.number().int().nonnegative(),
  retention_7d: z.object({
    cohort: z.number().int().nonnegative(),
    retained: z.number().int().nonnegative(),
  }),
  ai_extraction_30d: z.object({
    ok: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  adoption_30d: z.record(z.string(), z.number().int().nonnegative()),
});
export type RawPlatformMetrics = z.infer<typeof RawPlatformMetricsSchema>;

export interface PlatformMetrics {
  at: string;
  users: { registered: number; new7d: number; new30d: number };
  active: { dau: number; wau: number; mau: number };
  onboarded: number;
  activated: number;
  /** Activated ÷ registered. */
  activationRate: number | null;
  /** Of the people who signed up 7–14 days ago, the share active again 7–14 days after signing up. */
  retention7d: { cohort: number; retained: number; rate: number | null };
  /** AI label reads in the last 30 days that came back usable ÷ all that reached the provider. */
  aiExtraction: { ok: number; failed: number; rate: number | null };
  /** Distinct people per feature in the last 30 days, and as a share of monthly active people. */
  adoption30d: Array<{ feature: string; people: number; ofMau: number | null }>;
}

const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);

export function derivePlatformMetrics(raw: RawPlatformMetrics): PlatformMetrics {
  const { ok, failed } = raw.ai_extraction_30d;
  return {
    at: raw.at,
    users: { registered: raw.registered, new7d: raw.new_7d, new30d: raw.new_30d },
    active: { dau: raw.dau, wau: raw.wau, mau: raw.mau },
    onboarded: raw.onboarded,
    activated: raw.activated,
    activationRate: rate(raw.activated, raw.registered),
    retention7d: {
      ...raw.retention_7d,
      rate: rate(raw.retention_7d.retained, raw.retention_7d.cohort),
    },
    aiExtraction: { ok, failed, rate: rate(ok, ok + failed) },
    adoption30d: Object.entries(raw.adoption_30d)
      .map(([feature, people]) => ({ feature, people, ofMau: rate(people, raw.mau) }))
      .sort((a, b) => b.people - a.people || a.feature.localeCompare(b.feature)),
  };
}
