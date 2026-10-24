import "server-only";
import { getAiBudgetEnv } from "@/server/env";
import { logError, logWarn } from "@/server/log";
import { createServiceClient } from "./client";

/**
 * Takes room for one AI call in the platform budget (public.ai_budget_hold, serialised in the database so
 * simultaneous calls cannot both take the last room). Returns the hold id, or null when the budget is used up.
 * Throws when the budget cannot be checked; the caller then lets the call through (see withBudget).
 * With no budget configured there is nothing to check and no database round trip.
 */
export async function holdAiBudget(task: string, estimateUsdMicro: number): Promise<string | null> {
  const { dailyUsdMicro, monthlyUsdMicro } = getAiBudgetEnv();
  if (dailyUsdMicro === null && monthlyUsdMicro === null) return "";
  const db = createServiceClient();
  if (!db) throw new Error("no service role");
  const { data, error } = await db.rpc("ai_budget_hold", {
    p_task: task,
    p_estimate: estimateUsdMicro,
    // Generated types say number; NULL is how the function is told "no limit of this kind".
    p_daily: dailyUsdMicro as number,
    p_monthly: monthlyUsdMicro as number,
  });
  if (error) {
    logError("ai_budget_check_failed", error);
    throw error;
  }
  if (data === null) logWarn("ai_budget_exhausted", { task });
  return data;
}

/** Removes a hold once its call's usage is recorded (best effort: an unreleased hold expires on its own). */
export async function releaseAiBudget(holdId: string): Promise<void> {
  const db = createServiceClient();
  if (!db) return;
  const { error } = await db.from("ai_budget_holds").delete().eq("id", holdId);
  if (error) logWarn("ai_budget_release_failed", { code: error.code });
}
