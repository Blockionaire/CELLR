import "server-only";
import { costOf } from "@/server/ai/pricing";
import type { AiUsage } from "@/server/ai/types";
import { logError } from "@/server/log";
import { releaseAiBudget } from "./ai-budget";
import { createServiceClient } from "./client";

export type AiUsageStatus =
  "ok" | "error" | "timeout" | "invalid_output" | "rate_limited" | "budget_exhausted";

export interface AiUsageEntry {
  userId: string;
  householdId: string | null;
  task: string;
  status: AiUsageStatus;
  usage: AiUsage;
}

/**
 * Every AI call is accounted for: what, by whom, which model actually answered, how big, how long, how it
 * ended, and what it cost (an estimate in micro-USD from the versioned price list; NULL when unknown, never a
 * made-up 0). One row per call, all its attempts included, so nothing is counted twice. Written with the service
 * role because people cannot write their own usage; if the key is missing or the write fails, the call it
 * describes has already happened and must not fail because of it. The call's budget hold is released here.
 */
export async function recordAiUsage(entry: AiUsageEntry): Promise<void> {
  const { usage } = entry;
  const cost = costOf(usage);
  const db = createServiceClient();
  if (db) {
    const row = {
      user_id: entry.userId,
      household_id: entry.householdId,
      task: entry.task,
      model: usage.servedModel ?? usage.model,
      tokens_in: usage.tokensIn,
      tokens_out: usage.tokensOut,
      latency_ms: usage.latencyMs,
      status: entry.status,
    };
    let { error } = await db.from("ai_usage").insert({
      ...row,
      tokens_cached_in: usage.tokensCachedIn ?? 0,
      web_search_calls: usage.webSearchCalls ?? 0,
      cost_usd_micro: cost.usdMicro,
      // Unknown cost: the budget keeps counting what it held for the call.
      cost_hold_usd_micro:
        cost.usdMicro === null ? (usage.budgetHold?.estimateUsdMicro ?? null) : null,
      pricing_version: cost.pricingVersion,
    });
    // Before the cost migration has run (PGRST204: unknown column), the plain row is still worth keeping.
    if (error?.code === "PGRST204" || error?.code === "42703")
      ({ error } = await db.from("ai_usage").insert(row));
    if (error) logError("ai_usage_not_recorded", error);
  }
  if (usage.budgetHold) await releaseAiBudget(usage.budgetHold.id);
}
