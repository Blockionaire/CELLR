/**
 * Whether the Smart Cellar API (/api/v1/smart-cellar, export version 2) answers in this deployment, and whether it
 * may write (sprint 1C). The database having the Smart Cellar columns switches NOTHING on: only this does.
 *
 * ONE SETTING, CELLR_SMART_CELLAR, read on the server only:
 *   unset, empty, "off", or anything else   everything closed: the routes answer 404, as if they did not exist.
 *   "read"                                   reading places in the new terms, and export version 2.
 *   "write"                                  reading, and saving a layout: BUT ONLY WHERE WRITES MAY BE OPEN (below).
 *
 * WRITES ARE NEVER OPEN ON PRODUCTION, whatever is set. Saving layouts for real users is a separate decision of the
 * owner; when it is taken, it is taken in code (a reviewed change to this file), not by a variable someone can set by
 * mistake. Until then "write" opens writes in exactly two places, the gallery gate's (lib/cellar-gallery-gate.ts):
 *   1. `next dev` (NODE_ENV "development"), unless the environment says it is production;
 *   2. a Vercel PREVIEW deployment (VERCEL_ENV "preview", and no custom target environment).
 * Everything else, above all a production build that carries no Vercel marker, can at most read. Writes that are
 * open still meet the database's own rules: one bottle per cell (the depth switch and the legacy unique index).
 */
export type SmartCellarEnv = Readonly<Record<string, string | undefined>>;

export interface SmartCellarAccess {
  reads: boolean;
  writes: boolean;
}

export const SMART_CELLAR_CLOSED: SmartCellarAccess = Object.freeze({
  reads: false,
  writes: false,
});

/** Whether this environment is one where a write MAY be opened (never production; see above). */
export function writesMayOpenIn(env: SmartCellarEnv): boolean {
  const vercelEnv = env.VERCEL_ENV;
  const target = env.VERCEL_TARGET_ENV;
  if (vercelEnv === "production" || target === "production") return false;
  if (env.NODE_ENV === "development") return true;
  return vercelEnv === "preview" && (target === undefined || target === "preview");
}

/** The rule, on an environment handed to it. The app asks through `getSmartCellarAccess()` in src/server/env.ts. */
export function smartCellarAccessIn(env: SmartCellarEnv): SmartCellarAccess {
  const mode = (env.CELLR_SMART_CELLAR ?? "").trim().toLowerCase();
  if (mode === "read") return Object.freeze({ reads: true, writes: false });
  if (mode === "write") return Object.freeze({ reads: true, writes: writesMayOpenIn(env) });
  return SMART_CELLAR_CLOSED;
}
