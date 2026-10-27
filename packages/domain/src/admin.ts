import { z } from "zod";

/**
 * THE INTERNAL ADMIN DASHBOARD: who may see it, and the shapes of what it reads. Read-only. The numbers come from
 * the database functions in 20261026000018_admin_dashboard.sql and platform_metrics(); definitions in
 * docs/METRICS.md.
 */

// ---- Who is an admin -------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The admins, from CELLR_ADMIN_USER_IDS: Supabase Auth user ids, comma-separated. Fails closed: unset, empty, or
 * any entry that is not a user id makes the whole list empty (a typo must never quietly admit someone or leave a
 * half-meant list in force).
 */
export function parseAdminAllowlist(raw: string | null | undefined): ReadonlySet<string> {
  if (!raw || raw.trim() === "") return new Set();
  const ids = raw.split(",").map((s) => s.trim().toLowerCase());
  if (ids.length > 50 || ids.some((id) => !UUID.test(id))) return new Set();
  return new Set(ids);
}

export function isAdminUser(userId: string | null | undefined, allowlist: ReadonlySet<string>) {
  return (
    typeof userId === "string" &&
    UUID.test(userId.toLowerCase()) &&
    allowlist.has(userId.toLowerCase())
  );
}

export const isUserId = (value: string) => UUID.test(value.toLowerCase());

// ---- What a page asks for ----------------------------------------------------------------------------------------

export const ADMIN_RANGES = [7, 30, 90] as const;
export type AdminRange = (typeof ADMIN_RANGES)[number];

/** A range from the address bar; anything else is the 30-day default. */
export function parseAdminRange(
  value: string | string[] | undefined,
  fallback: AdminRange = 30,
): AdminRange {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (ADMIN_RANGES as readonly number[]).includes(n) ? (n as AdminRange) : fallback;
}

export const ADMIN_PAGE_SIZE = 25;

/** A 1-based page from the address bar, clamped to something sane. */
export function parseAdminPage(value: string | string[] | undefined): number {
  const n = Math.floor(Number(Array.isArray(value) ? value[0] : value));
  return Number.isFinite(n) && n >= 1 && n <= 10_000 ? n : 1;
}

// ---- Users -------------------------------------------------------------------------------------------------------

export const AdminUserRowSchema = z.object({
  user_id: z.string(),
  display_name: z.string().nullable(),
  created_at: z.string(),
  last_active_at: z.string().nullable(),
  onboarded: z.boolean(),
  activated: z.boolean(),
  households: z.number(),
  bottles_added: z.number(),
  total: z.number(),
});
export type AdminUserRow = z.infer<typeof AdminUserRowSchema>;

export const AdminUserSummarySchema = z.object({
  user_id: z.string(),
  display_name: z.string().nullable(),
  created_at: z.string(),
  last_sign_in_at: z.string().nullable(),
  households: z.number(),
  bottles_added: z.number(),
  bottles_opened: z.number(),
  ratings: z.number(),
  ai_30d: z.array(
    z.object({
      task: z.string(),
      calls: z.number(),
      ok: z.number(),
      known_cost_usd_micro: z.number(),
      unknown_cost_calls: z.number(),
    }),
  ),
  events_30d: z.record(z.string(), z.number()),
});
export type AdminUserSummary = z.infer<typeof AdminUserSummarySchema>;

// ---- AI & costs --------------------------------------------------------------------------------------------------

const Count = z.coerce.number();
const Split = z.object({
  key: z.string(),
  calls: Count,
  ok: Count,
  known_cost: Count,
  unknown_calls: Count,
  web_searches: Count,
  tokens_in: Count,
  tokens_out: Count,
});

export const AdminAiCostsSchema = z.object({
  from: z.string(),
  to: z.string(),
  totals: z.object({
    calls: Count,
    ok: Count,
    failed: Count,
    timeout: Count,
    rate_limited: Count,
    blocked: Count,
    known_cost: Count,
    unknown_calls: Count,
    unknown_held: Count,
    tokens_in: Count,
    tokens_cached_in: Count,
    tokens_out: Count,
    web_searches: Count,
    avg_latency_ms: Count.nullable(),
  }),
  by_day: z.array(
    z.object({ day: z.string(), calls: Count, known_cost: Count, unknown_calls: Count }),
  ),
  by_task: z.array(Split),
  by_model: z.array(Split),
});
export type AdminAiCosts = z.infer<typeof AdminAiCostsSchema>;

export const AdminBudgetStatusSchema = z.object({
  recorded_day: Count,
  recorded_month: Count,
  holds_day: Count,
  holds_month: Count,
  holds_open: Count,
});
export type AdminBudgetStatus = z.infer<typeof AdminBudgetStatusSchema>;

/** Scans the recognition cache answered (hit, no vision call) or did not (miss) in a window. */
export const AdminRecognitionCacheSchema = z.object({ hits: Count, misses: Count });
export type AdminRecognitionCache = z.infer<typeof AdminRecognitionCacheSchema>;

/**
 * Hits are vision calls avoided (each hit is a scan that did not ask the model). The hit rate is over scans that
 * looked in the cache; null with no such scans yet.
 */
export const summarizeRecognitionCache = (c: AdminRecognitionCache) => ({
  hits: c.hits,
  misses: c.misses,
  visionCallsAvoided: c.hits,
  hitRate: shareOf(c.hits, c.hits + c.misses),
});

/** Wine profiles reused from the shared cache (hit) or researched after looking (miss), plus the shared store. */
export const AdminSharedProfilesSchema = z.object({
  hits: Count,
  misses: Count,
  profiles: Count,
  review_due: Count,
});
export type AdminSharedProfiles = z.infer<typeof AdminSharedProfilesSchema>;

/**
 * Hits are paid research calls avoided. The hit rate is over shareable wines that looked (a household's own
 * provisional wines never look, so they are in neither figure). `researchCalls`: wine_insight calls actually made.
 */
export const summarizeSharedProfiles = (s: AdminSharedProfiles, researchCalls: number | null) => ({
  hits: s.hits,
  misses: s.misses,
  researchCallsAvoided: s.hits,
  hitRate: shareOf(s.hits, s.hits + s.misses),
  sharedProfiles: s.profiles,
  reviewDue: s.review_due,
  researchCalls,
});

/** USD per web search call (10 USD per 1 000), the part of a search's price that can be told apart. */
export const WEB_SEARCH_FEE_USD_MICRO = 10_000;

/** A share, or null ("insufficient data") when there is nothing to divide by. */
export const shareOf = (part: number, whole: number): number | null =>
  whole > 0 ? part / whole : null;

/**
 * The headline figures of a cost window. Rates are over calls that reached the provider (blocked calls never
 * did). The known cost is an estimate from the price list, not an invoice; unknown-cost calls are reported
 * apart and never as free. Search fees are the per-call part only (search content tokens are inside tokens_in).
 */
export function summarizeAiCosts(c: AdminAiCosts) {
  const t = c.totals;
  const sent = t.calls - t.blocked;
  return {
    calls: t.calls,
    sent,
    blocked: t.blocked,
    successRate: shareOf(t.ok, sent),
    failureRate: shareOf(t.failed + t.rate_limited, sent),
    timeoutRate: shareOf(t.timeout, sent),
    knownCostUsdMicro: t.known_cost,
    unknownCostCalls: t.unknown_calls,
    unknownHeldUsdMicro: t.unknown_held,
    searchFeesUsdMicro: t.web_searches * WEB_SEARCH_FEE_USD_MICRO,
    webSearches: t.web_searches,
    tokensIn: t.tokens_in,
    tokensCachedIn: t.tokens_cached_in,
    tokensOut: t.tokens_out,
    avgLatencyMs: t.avg_latency_ms,
  };
}

/**
 * The platform budget against its limits, as ai_budget_hold() counts it: recorded usage plus outstanding holds.
 * A limit of null means none is configured; the share is then null.
 */
export function budgetUse(
  status: AdminBudgetStatus,
  limits: { daily: number | null; monthly: number | null },
) {
  const day = status.recorded_day + status.holds_day;
  const month = status.recorded_month + status.holds_month;
  return {
    day: {
      recorded: status.recorded_day,
      held: status.holds_day,
      total: day,
      limit: limits.daily,
      share: limits.daily ? day / limits.daily : null,
    },
    month: {
      recorded: status.recorded_month,
      held: status.holds_month,
      total: month,
      limit: limits.monthly,
      share: limits.monthly ? month / limits.monthly : null,
    },
    openHolds: status.holds_open,
  };
}

// ---- Activity ----------------------------------------------------------------------------------------------------

export const AdminActivityDaySchema = z.object({
  day: z.string(),
  signups: Count,
  active: Count,
  scans: Count,
  extraction_ok: Count,
  extraction_failed: Count,
  sommelier: Count,
  insights: Count,
  valuations: Count,
  tonight: Count,
  cellar_3d: Count,
  bottles_added: Count,
});
export const AdminActivitySchema = z.array(AdminActivityDaySchema);
export type AdminActivityDay = z.infer<typeof AdminActivityDaySchema>;

/** Totals over the series, and the AI extraction success rate (valid structured output, not recognition). */
export function sumActivity(days: readonly AdminActivityDay[]) {
  const sum = (k: keyof Omit<AdminActivityDay, "day">) => days.reduce((s, d) => s + d[k], 0);
  const ok = sum("extraction_ok");
  const failed = sum("extraction_failed");
  return {
    signups: sum("signups"),
    scans: sum("scans"),
    extractionSuccess: shareOf(ok, ok + failed),
    sommelier: sum("sommelier"),
    insights: sum("insights"),
    valuations: sum("valuations"),
    tonight: sum("tonight"),
    cellar3d: sum("cellar_3d"),
    bottlesAdded: sum("bottles_added"),
    peakActive: Math.max(0, ...days.map((d) => d.active)),
  };
}
