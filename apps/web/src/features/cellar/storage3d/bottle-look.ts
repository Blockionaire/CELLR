import type { QualitySpec } from "./model";
import type { Fidelity } from "./palette";

/**
 * What a bottle is made of, as numbers, in ONE place: the storage view's instanced bottles (resources.ts) and the
 * bottle on display (hero-kit.ts) both read it, so the bottle on display, at the moment it leaves its place and
 * the moment it is back, is the storage view's bottle exactly: no step in colour, shine or roughness.
 *
 * `classic`: as sprints 2A and 2B.1 drew it. `premium` (sprint 2B.2): less of a polished toy. Real glass is not a
 * mirror: its highlights are soft-edged and it shows the room faintly; foil is satin, not chrome; paper is matt.
 */
export interface GlassLook {
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  env: number;
}

/** The glass of a bottle in its place, at a level of detail. */
export function placeGlass(quality: QualitySpec, fidelity: Fidelity = "premium"): GlassLook {
  if (fidelity === "classic")
    return quality.clearcoat
      ? { roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, env: 1.35 }
      : { roughness: 0.08, metalness: 0.1, clearcoat: 0, clearcoatRoughness: 0.03, env: 1.5 };
  return quality.clearcoat
    ? { roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.09, env: 1.05 }
    : { roughness: 0.16, metalness: 0.06, clearcoat: 0, clearcoatRoughness: 0.09, env: 1.15 };
}

/** The glass of the bottle on display: seen large, so a little finer than in its place, and still not a mirror. */
export const shownGlass = (fidelity: Fidelity = "premium"): GlassLook =>
  fidelity === "classic"
    ? { roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, env: 1.3 }
    : { roughness: 0.07, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, env: 1.1 };

/** The capsule over the cork. */
export const foilLook = (fidelity: Fidelity = "premium") =>
  fidelity === "classic"
    ? { roughness: 0.32, metalness: 0.75, env: 1.1 }
    : { roughness: 0.42, metalness: 0.66, env: 0.9 };

/** The label's paper. */
export const paperLook = (fidelity: Fidelity = "premium") =>
  fidelity === "classic" ? { roughness: 0.85 } : { roughness: 0.92 };

/** The paper colour a label has before its print is on it (and from a distance). */
export const PAPER_COLOUR = "#e8dcc2";
