import {
  PRODUCTION_DATABASE_HOSTS,
  hostOf,
  type WriteTargetEnv,
} from "./smart-cellar-write-target";

/**
 * THE PRODUCTION RELEASE OF SMART CELLAR 3D (owner decision, 2026-11-21: full rollout to every signed-in user).
 *
 * Until now every Smart Cellar gate opened only in `next dev` and on Vercel previews, and every write needed a
 * database known NOT to be production. That absolute block is replaced by ONE explicit, checked authorization. A
 * deployment is released when ALL of these hold:
 *
 *   1. it is a Vercel PRODUCTION deployment: VERCEL "1", VERCEL_ENV "production", and VERCEL_TARGET_ENV
 *      "production" or unset (never a preview, never a custom environment such as staging);
 *   2. CELLR_SMART_CELLAR_PRODUCTION_DATABASE names, exactly (a bare lower-case host, nothing else), the database host
 *      this server actually connects to (NEXT_PUBLIC_SUPABASE_URL, the server's own configuration, never a request);
 *   3. that host is one of PRODUCTION_DATABASE_HOSTS, a list in code.
 *
 * A released deployment may show what the feature settings open (CELLR_SMART_CELLAR, _3D, _BUILDER, _PLACEMENT,
 * _ADVICE) and, where CELLR_SMART_CELLAR is "write", write to that database. Everything else is exactly as before:
 *   - a PREVIEW never gains production write authority: it is not a production deployment, so (1) fails, and its
 *     own writes still need a database known not to be production (smart-cellar-write-target.ts);
 *   - an UNKNOWN environment (a production build without Vercel markers, a custom environment) fails closed;
 *   - a declaration that names another host, a wildcard, a scheme or a path opens nothing;
 *   - depth (index > 1) stays off whatever is set (DEPTH_PLACEMENT_ENABLED and the database's own switch).
 *
 * EMERGENCY KILL SWITCH: CELLR_SMART_CELLAR=off (or removing it). Every gate needs the Smart Cellar API to read, so
 * this closes the new 3D view, the Rack Builder, placement, advice and every new endpoint (404) at once, and the
 * existing views take over. "read" keeps the views and closes every write.
 */
export type ReleaseEnv = WriteTargetEnv;

/** A Vercel production deployment, and nothing else (not a preview, not a custom target, not an unmarked build). */
export function vercelProductionIn(env: ReleaseEnv): boolean {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "production") return false;
  return env.VERCEL_TARGET_ENV === undefined || env.VERCEL_TARGET_ENV === "production";
}

/** What a declared host may look like: a bare DNS name, lower case. */
const HOST_NAME =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Whether this deployment is the authorized production release (the three conditions above). */
export function productionReleaseIn(env: ReleaseEnv): boolean {
  if (!vercelProductionIn(env)) return false;
  const declared = env.CELLR_SMART_CELLAR_PRODUCTION_DATABASE;
  if (declared === undefined || !HOST_NAME.test(declared)) return false;
  const host = hostOf(env.NEXT_PUBLIC_SUPABASE_URL);
  return host !== null && host === declared && PRODUCTION_DATABASE_HOSTS.includes(host);
}
