import "server-only";
import {
  AdminActivitySchema,
  AdminFeedbackPageSchema,
  AdminAiCostsSchema,
  AdminBudgetStatusSchema,
  AdminRecognitionCacheSchema,
  AdminSharedProfilesSchema,
  AdminUserRowSchema,
  AdminUserSummarySchema,
  type AdminActivityDay,
  type AdminAiCosts,
  type AdminBudgetStatus,
  type AdminRecognitionCache,
  type AdminSharedProfiles,
  type AdminFeedbackPage,
  type FeedbackCategory,
  type AdminRange,
  type AdminUserRow,
  type AdminUserSummary,
} from "@cellr/domain";
import { assertAdmin, type AdminSession } from "@/server/admin/access";
import { createServiceClient } from "./client";

/**
 * Read-only, platform-wide reads for the admin dashboard, with the service role. Every function takes the admin
 * session that only `verifyAdmin` issues, and checks it again at run time: nothing here runs before the admin
 * check. "missing" means the database step (20261026000018_admin_dashboard.sql) has not been taken yet; null
 * means the service role is not configured.
 */
type Read<T> = Promise<T | "missing" | null>;

const missing = (error: { code?: string; message?: string }) =>
  error.code === "PGRST202" || error.code === "42883" || error.code === "PGRST205";

async function call<T>(
  session: AdminSession,
  fn:
    | "admin_user_directory"
    | "admin_user_summary"
    | "admin_ai_costs"
    | "admin_budget_status"
    | "admin_activity_series"
    | "admin_beta_feedback"
    | "admin_recognition_cache"
    | "admin_shared_profiles",
  args: Record<string, unknown>,
  parse: (data: unknown) => T,
): Read<T> {
  assertAdmin(session);
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await (
    db.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
  )(fn, args);
  if (error) {
    if (missing(error)) return "missing";
    throw error;
  }
  return parse(data);
}

export function readUserDirectory(
  session: AdminSession,
  page: number,
  size: number,
): Read<AdminUserRow[]> {
  return call(
    session,
    "admin_user_directory",
    { p_limit: size, p_offset: (page - 1) * size },
    (d) => AdminUserRowSchema.array().parse(d),
  );
}

export function readUserSummary(
  session: AdminSession,
  userId: string,
): Read<AdminUserSummary | "none"> {
  return call(session, "admin_user_summary", { p_user: userId }, (d) =>
    d === null ? "none" : AdminUserSummarySchema.parse(d),
  );
}

export function readAiCosts(session: AdminSession, from: Date, to: Date): Read<AdminAiCosts> {
  return call(
    session,
    "admin_ai_costs",
    { p_from: from.toISOString(), p_to: to.toISOString() },
    (d) => AdminAiCostsSchema.parse(d),
  );
}

export function readBudgetStatus(session: AdminSession, now: Date): Read<AdminBudgetStatus> {
  return call(session, "admin_budget_status", { p_now: now.toISOString() }, (d) =>
    AdminBudgetStatusSchema.parse(d),
  );
}

export function readActivity(
  session: AdminSession,
  days: AdminRange,
  now: Date,
): Read<AdminActivityDay[]> {
  return call(session, "admin_activity_series", { p_days: days, p_now: now.toISOString() }, (d) =>
    AdminActivitySchema.parse(d),
  );
}

/** Beta feedback, newest first, one page (optionally one category), with the counts per category. */
export function readFeedback(
  session: AdminSession,
  category: FeedbackCategory | null,
  page: number,
  size: number,
): Read<AdminFeedbackPage> {
  return call(
    session,
    "admin_beta_feedback",
    { p_category: category, p_limit: size, p_offset: (page - 1) * size },
    (d) => AdminFeedbackPageSchema.parse(d),
  );
}

/** "missing" here also means only the recognition-cache step (20261029000021) is still to be taken. */
export function readRecognitionCache(
  session: AdminSession,
  from: Date,
  to: Date,
): Read<AdminRecognitionCache> {
  return call(
    session,
    "admin_recognition_cache",
    { p_from: from.toISOString(), p_to: to.toISOString() },
    (d) => AdminRecognitionCacheSchema.parse(d),
  );
}

/** "missing" here also means only the shared-profile step (20261030000022) is still to be taken. */
export function readSharedProfiles(
  session: AdminSession,
  from: Date,
  to: Date,
): Read<AdminSharedProfiles> {
  return call(
    session,
    "admin_shared_profiles",
    { p_from: from.toISOString(), p_to: to.toISOString() },
    (d) => AdminSharedProfilesSchema.parse(d),
  );
}
