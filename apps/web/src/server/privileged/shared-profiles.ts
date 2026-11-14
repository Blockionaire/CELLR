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

/** What a claim call answered: whether to research now, and the token that gives the claim back (if one was taken). */
export interface ResearchClaim {
  /** True: research now. False: another request holds the claim; wait for its profile. */
  mine: boolean;
  /** The proof of holding the claim; null when nothing was claimed (nothing to share, or the claim could not be asked). */
  token: string | null;
}

const GO_AHEAD: ResearchClaim = { mine: true, token: null };

/**
 * Says "this vintage is being researched in this language now" (public.claim_shared_profile_research). `mine` with
 * a token: this request holds the claim and must give it back with that token. `mine` without a token: there is
 * nothing to share, or the claim cannot be asked (no service role, no database step, an error): everything works as
 * before, and nothing is given back. Not `mine`: another request claimed it moments ago; its profile is worth
 * waiting for instead of paying for the same research twice.
 */
export async function claimSharedProfileResearch(
  vintageId: string,
  language: ProfileLanguage,
): Promise<ResearchClaim> {
  const db = createServiceClient();
  if (!db) return GO_AHEAD;
  const { data, error } = await db.rpc("claim_shared_profile_research", {
    p_vintage_id: vintageId,
    p_language: language,
  });
  if (error) {
    if (error.code !== "PGRST202" && error.code !== "42883")
      logError("shared_profile_claim_failed", error);
    return GO_AHEAD;
  }
  const answer = data as { granted?: unknown; token?: unknown } | null;
  if (!answer || typeof answer !== "object") return GO_AHEAD;
  if (answer.granted === false) return { mine: false, token: null };
  return { mine: true, token: typeof answer.token === "string" ? answer.token : null };
}

/**
 * Gives the research claim back (public.release_shared_profile_research): this request is done with the vintage,
 * whatever came of it. Only the token that took the claim gives it back, so a request that lost its claim meanwhile
 * changes nothing. Never throws: a claim that cannot be given back expires by itself.
 */
export async function releaseSharedProfileResearch(
  vintageId: string,
  language: ProfileLanguage,
  token: string,
): Promise<void> {
  const db = createServiceClient();
  if (!db) return;
  const { error } = await db.rpc("release_shared_profile_research", {
    p_vintage_id: vintageId,
    p_language: language,
    p_token: token,
  });
  if (error && error.code !== "PGRST202" && error.code !== "42883")
    logError("shared_profile_release_failed", error);
}
