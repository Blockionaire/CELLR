import "server-only";
import { cache } from "react";
import {
  ADMIN_PAGE_SIZE,
  FEEDBACK_PAGE_SIZE,
  budgetUse,
  isUserId,
  summarizeAiCosts,
  summarizeRecognitionCache,
  summarizeSharedProfiles,
  catalogShare,
  sumActivity,
  type AdminRange,
  type FeedbackCategory,
} from "@cellr/domain";
import { getPageContext } from "@/server/context";
import { getAdminAllowlist, getAiBudgetEnv } from "@/server/env";
import {
  readActivity,
  readAiCosts,
  readBudgetStatus,
  readFeedback,
  readRecognitionCache,
  readSharedProfiles,
  readCatalog,
  readUserDirectory,
  readUserSummary,
} from "@/server/privileged/admin";
import { getPlatformMetrics } from "@/server/privileged/metrics";
import { assertAdmin, verifyAdmin, type AdminSession } from "./access";

/**
 * The admin dashboard's data, for its Server Components only (there is no admin API: nothing here is reachable
 * over HTTP except through a page that has passed the check). Every read takes the admin session again.
 */

/** The admin check for a page render: the verified session's user id against the server-only allowlist. */
export const getAdminSession = cache(async (): Promise<AdminSession | null> =>
  verifyAdmin({
    session: async () => getPageContext(),
    confirm: async () => {
      const ctx = await getPageContext();
      if (!ctx) return null;
      const { data, error } = await ctx.db.auth.getUser();
      return error ? null : (data.user?.id ?? null);
    },
    allowlist: getAdminAllowlist,
  }),
);

const day = 86_400_000;
const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const startOfUtcMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

export async function adminOverview(session: AdminSession, now = new Date()) {
  assertAdmin(session);
  const end = new Date(now.getTime() + 60_000);
  const [metrics, today, month] = await Promise.all([
    getPlatformMetrics(now).catch(() => null),
    readAiCosts(session, startOfUtcDay(now), end),
    readAiCosts(session, startOfUtcMonth(now), end),
  ]);
  return {
    metrics,
    spendToday: typeof today === "object" && today ? summarizeAiCosts(today) : today,
    spendMonth: typeof month === "object" && month ? summarizeAiCosts(month) : month,
  };
}

export async function adminUsers(session: AdminSession, page: number) {
  assertAdmin(session);
  const rows = await readUserDirectory(session, page, ADMIN_PAGE_SIZE);
  if (!Array.isArray(rows)) return rows;
  const total = rows[0]?.total ?? 0;
  return { rows, page, total, pages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)) };
}

export async function adminUser(session: AdminSession, userId: string) {
  assertAdmin(session);
  if (!isUserId(userId)) return "none" as const;
  return readUserSummary(session, userId.toLowerCase());
}

export async function adminProduct(session: AdminSession, days: AdminRange, now = new Date()) {
  assertAdmin(session);
  const [metrics, series] = await Promise.all([
    getPlatformMetrics(now).catch(() => null),
    readActivity(session, days, now),
  ]);
  return { metrics, series, totals: Array.isArray(series) ? sumActivity(series) : null };
}

export async function adminAi(session: AdminSession, days: AdminRange, now = new Date()) {
  assertAdmin(session);
  const end = new Date(now.getTime() + 60_000);
  const from = new Date(startOfUtcDay(now).getTime() - (days - 1) * day);
  const [range, today, week, month, budget, cache, shared, catalog] = await Promise.all([
    readAiCosts(session, from, end),
    readAiCosts(session, startOfUtcDay(now), end),
    readAiCosts(session, new Date(startOfUtcDay(now).getTime() - 6 * day), end),
    readAiCosts(session, startOfUtcMonth(now), end),
    readBudgetStatus(session, now),
    readRecognitionCache(session, from, end),
    readSharedProfiles(session, from, end),
    readCatalog(session, from, end),
  ]);
  const sum = (c: typeof range) => (typeof c === "object" && c ? summarizeAiCosts(c) : null);
  const limits = getAiBudgetEnv();
  return {
    range,
    summary: sum(range),
    today: sum(today),
    week: sum(week),
    month: sum(month),
    budget:
      typeof budget === "object" && budget
        ? budgetUse(budget, { daily: limits.dailyUsdMicro, monthly: limits.monthlyUsdMicro })
        : budget,
    /** Null: not configured, or the cache's database step is not taken yet. */
    cache: typeof cache === "object" && cache ? summarizeRecognitionCache(cache) : null,
    /** Null: not configured, or the shared-profile step is not taken yet. */
    shared:
      typeof shared === "object" && shared
        ? summarizeSharedProfiles(
            shared,
            typeof range === "object" && range
              ? (range.by_task.find((t) => t.key === "wine_insight")?.calls ?? 0)
              : null,
          )
        : null,
    /** Null: not configured, or the catalogue step is not taken yet. */
    catalog:
      typeof catalog === "object" && catalog ? { ...catalog, share: catalogShare(catalog) } : null,
    ready: range !== "missing",
  };
}

export async function adminFeedback(
  session: AdminSession,
  category: FeedbackCategory | null,
  page: number,
) {
  assertAdmin(session);
  const data = await readFeedback(session, category, page, FEEDBACK_PAGE_SIZE);
  if (typeof data !== "object" || data === null) return data;
  return { ...data, page, pages: Math.max(1, Math.ceil(data.total / FEEDBACK_PAGE_SIZE)) };
}
