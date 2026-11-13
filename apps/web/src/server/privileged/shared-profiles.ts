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

/**
 * Says "this vintage is being researched in this language now" (public.claim_shared_profile_research). True: it is
 * this request's to research (also when there is nothing to share, or the claim cannot be taken: without the service
 * role or the database step everything works as before). False: another request claimed it moments ago; its profile
 * is worth waiting for instead of paying for the same research twice.
 */
export async function claimSharedProfileResearch(
  vintageId: string,
  language: ProfileLanguage,
): Promise<boolean> {
  const db = createServiceClient();
  if (!db) return true;
  const { data, error } = await db.rpc("claim_shared_profile_research", {
    p_vintage_id: vintageId,
    p_language: language,
  });
  if (error) {
    if (error.code !== "PGRST202" && error.code !== "42883")
      logError("shared_profile_claim_failed", error);
    return true;
  }
  return data !== false;
}

/**
 * Gives the research claim back (public.release_shared_profile_research): this request is done with the vintage,
 * whatever came of it. Never throws: a claim that cannot be given back expires by itself.
 */
export async function releaseSharedProfileResearch(
  vintageId: string,
  language: ProfileLanguage,
): Promise<void> {
  const db = createServiceClient();
  if (!db) return;
  const { error } = await db.rpc("release_shared_profile_research", {
    p_vintage_id: vintageId,
    p_language: language,
  });
  if (error && error.code !== "PGRST202" && error.code !== "42883")
    logError("shared_profile_release_failed", error);
}
