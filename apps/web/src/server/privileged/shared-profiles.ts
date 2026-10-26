import "server-only";
import type { InsightOutput, ProfileLanguage } from "@cellr/domain";
import { logError } from "@/server/log";
import { createServiceClient } from "./client";

/**
 * Offers a household's freshly researched profile as the shared profile for its vintage and language. Only the
 * server may do this (people cannot write shared profiles), and only after the caller checked it with
 * `shareableInsight`; the database checks the wine's shared identity and the quality bar again. Idempotent: when
 * another household published first, or a newer profile is there, nothing changes. Never fails the caller: the
 * household's own profile is already saved, and without the service role or the database step nothing is shared.
 */
export async function publishSharedProfile(entry: {
  vintageId: string;
  language: ProfileLanguage;
  output: InsightOutput;
  model: string;
  generatedAt: string;
}): Promise<boolean> {
  const db = createServiceClient();
  if (!db) return false;
  const { data, error } = await db.rpc("publish_shared_wine_profile", {
    p_vintage_id: entry.vintageId,
    p_language: entry.language,
    // Only what is public about the wine: the checked profile, never a value or anything of the household.
    p_output: { ...entry.output, value: null },
    p_model: entry.model,
    p_generated_at: entry.generatedAt,
  });
  if (error) {
    // Not set up yet (PGRST202/42883) is expected before the migration; anything else is worth a log line.
    if (error.code !== "PGRST202" && error.code !== "42883")
      logError("shared_profile_not_published", error);
    return false;
  }
  return data === true;
}
