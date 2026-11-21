import type { PlacementAccess } from "./smart-cellar-placement-gate";
import { internalPreviewIn } from "./smart-cellar-renderer-gate";

/**
 * Whether CELLR may advise where a bottle goes (Smart Cellar 3D, sprint 5; ADR-009). A gate of its own, decided on the
 * server.
 *
 * ONE SETTING, CELLR_SMART_CELLAR_ADVICE, read on the server only. Open only when it is exactly "1" AND the deployment
 * is one where unreleased work may be shown (`next dev`, a Vercel preview; never production, never a deployment that
 * cannot be told) AND the placement experience is open (advice lives in its panel).
 *
 * Advice is READ-ONLY: it grants no write of any kind. Acting on it is the Sprint 4 move, which keeps its own gate and
 * write-target checks; on a preview that may not write, advice can be read and "place here" stays unavailable.
 * It calls no model and has nothing to do with the AI Sommelier's keys or costs.
 */
export type AdviceEnv = Readonly<Record<string, string | undefined>>;

export function adviceOpenIn(env: AdviceEnv, placement: PlacementAccess): boolean {
  return env.CELLR_SMART_CELLAR_ADVICE === "1" && internalPreviewIn(env) && placement.open;
}
