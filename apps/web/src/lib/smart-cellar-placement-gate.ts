import { DEPTH_PLACEMENT_ENABLED } from "@cellr/domain";
import type { SmartCellarAccess } from "./smart-cellar-gate";
import { smartCellarMayShowIn } from "./smart-cellar-renderer-gate";

/**
 * Whether bottles may be placed, moved and swapped through the Smart Cellar API and the new cellar view (Smart
 * Cellar 3D, sprint 4). A gate of its own, decided on the server.
 *
 * ONE SETTING, CELLR_SMART_CELLAR_PLACEMENT, read on the server only. Open only when it is exactly "1" AND the
 * deployment is one where unreleased work may be shown (`next dev`, a Vercel preview; never production, never a
 * deployment that cannot be told) AND the Smart Cellar API reads here.
 *
 * Opening it opens NO WRITES by itself. Moving a bottle through the new endpoints needs, in addition, the API's own
 * "write" level, which needs a deployment that may write and a database known not to be production
 * (smart-cellar-write-target.ts). So a preview that shares the production database can show where bottles are and
 * which spots are free, and cannot move one.
 *
 * Depth is a separate question again: `depth` is true only when the app's switch (DEPTH_PLACEMENT_ENABLED) is on;
 * the database has its own switch and its own index, and refuses on its own. Neither is on in this version.
 *
 * The existing ways of moving a bottle (/api/v1/bottles, the racks view) are not affected by this gate at all.
 */
export type PlacementEnv = Readonly<Record<string, string | undefined>>;

export interface PlacementAccess {
  /** The new placement experience may be shown. */
  open: boolean;
  /** The new endpoints may write. */
  canWrite: boolean;
  /** Spots past index 1 may be written (app side). */
  depth: boolean;
}

export const PLACEMENT_CLOSED: PlacementAccess = Object.freeze({
  open: false,
  canWrite: false,
  depth: false,
});

export function placementAccessIn(env: PlacementEnv, api: SmartCellarAccess): PlacementAccess {
  if (env.CELLR_SMART_CELLAR_PLACEMENT !== "1" || !smartCellarMayShowIn(env) || !api.reads)
    return PLACEMENT_CLOSED;
  return Object.freeze({
    open: true,
    canWrite: api.writes,
    depth: api.writes && DEPTH_PLACEMENT_ENABLED,
  });
}
