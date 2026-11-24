import { internalPreviewIn } from "./smart-cellar-renderer-gate";
import type { PlacementAccess } from "./smart-cellar-placement-gate";

/**
 * Whether this deployment may OFFER more than one bottle per cell (Smart Cellar 3D, sprint 9; ADR-011 §5). The app's
 * half of a three-part question, decided on the server:
 *   1. this gate: CELLR_SMART_CELLAR_DEPTH exactly "1", on a deployment where unreleased work may be shown
 *      (`next dev`, a Vercel preview: `internalPreviewIn`), and only where placement itself writes;
 *   2. the database's own switch (private.cellar_settings.depth_placement), and
 *   3. the old one-bottle-per-cell index gone, both read through public.smart_cellar_depth_status() (0054) by the
 *      service, per request, and only when this gate is open.
 * All three, or depth is off and every answer is exactly what it was before sprint 9.
 *
 * NEVER OPEN ON PRODUCTION BY CONFIGURATION. Unlike the other Smart Cellar gates this one does not accept the
 * authorized production release (lib/smart-cellar-release.ts): `internalPreviewIn` is false on every production
 * deployment, whatever is set there. Opening depth on production is a reviewed CODE change here (accepting
 * `productionReleaseIn(env)` as well), after the owner has decided ADR-011 phases A-D. Do not add this setting to the
 * release's list of settings.
 */
export type DepthEnv = Readonly<Record<string, string | undefined>>;

export function depthGateOpenIn(env: DepthEnv, placement: PlacementAccess): boolean {
  return env.CELLR_SMART_CELLAR_DEPTH === "1" && internalPreviewIn(env) && placement.canWrite;
}
