import "server-only";
import { logError } from "@/server/log";
import { createServiceClient } from "./client";

export interface AiUsageEntry {
  userId: string;
  householdId: string | null;
  task: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  status: "ok" | "error" | "timeout" | "invalid_output" | "rate_limited";
}

/**
 * Every AI call is accounted for (what, how big, how long, how it ended). Written with the service role
 * because people cannot write their own usage; if the key is missing or the write fails, the call it
 * describes has already happened and must not fail because of it.
 */
export async function recordAiUsage(entry: AiUsageEntry): Promise<void> {
  const db = createServiceClient();
  if (!db) return;
  const { error } = await db.from("ai_usage").insert({
    user_id: entry.userId,
    household_id: entry.householdId,
    task: entry.task,
    model: entry.model,
    tokens_in: entry.tokensIn,
    tokens_out: entry.tokensOut,
    latency_ms: entry.latencyMs,
    status: entry.status,
  });
  if (error) logError("ai_usage_not_recorded", error);
}
