import type { ImageRef, SmartPlacementView, SmartStorageUnitView } from "@cellr/domain";
import type { LabelSpec } from "../three/label-texture";

/**
 * FROM A REAL BOTTLE TO WHAT THE INSPECTION SHOWS (Smart Cellar 3D, sprint 2B.3): pure, so that what is said about a
 * bottle's place and what is printed on it can be tested without a browser. Nothing here makes anything up: every
 * word comes from the bottle's own record, and where the app does not know something, the result says so.
 */

/**
 * How a bottle's place may be put into words, by what the place's index MEANS (never by the number alone):
 * - `spot`: one bottle per position. Shelf and position say it all.
 * - `front` / `behind`: a place whose depth is known. Index 1 is the front; a higher index lies behind it.
 * - `compartment`: a bin. The index is a counter that shifts when a bottle is taken out: only the compartment is said.
 * - `unknown`: the app does not know how the place is arranged. The position is said; nothing about where in it.
 */
export type WhereKind = "spot" | "front" | "behind" | "compartment" | "unknown";

export interface Where {
  kind: WhereKind;
  row: number;
  col: number;
  /** Only meaningful for `behind`: how far from the front. Never shown for a compartment or an unknown place. */
  index: number;
}

export function whereOf(
  unit: Pick<SmartStorageUnitView, "indexMeaning" | "arrangementKnown">,
  placement: Pick<SmartPlacementView, "row" | "col" | "index">,
): Where {
  const at = { row: placement.row, col: placement.col, index: placement.index };
  if (!unit.arrangementKnown) return { kind: "unknown", ...at };
  if (unit.indexMeaning === "ordinal") return { kind: "compartment", ...at };
  if (unit.indexMeaning === "depth")
    return { kind: placement.index > 1 ? "behind" : "front", ...at };
  return { kind: "spot", ...at };
}

/** The address of one of the household's own photos, as every screen builds it (label-image.tsx). */
type PhotoUrl = (id: string, size: "photo" | "texture") => string;

/**
 * What the bottle on display wears. With a photo of its own label: that photo (the straightened label where there
 * is one). Without: the label is DRAWN from the wine's own names and year, which is the premium fallback, and never
 * an imitation of a real label. The back label is the wine's own photo of it, when the details have brought one.
 */
export function labelSpecOf(
  placement: Pick<SmartPlacementView, "producer" | "wineName" | "year" | "type" | "image">,
  place: string,
  photoUrl: PhotoUrl,
  back: ImageRef | null = null,
): LabelSpec {
  const image = placement.image;
  return {
    producer: placement.producer,
    name: placement.wineName,
    year: placement.year,
    place,
    type: placement.type,
    photoUrl: image ? photoUrl(image.id, image.texture ? "texture" : "photo") : null,
    textured: image?.texture === true,
    backPhotoUrl: back ? photoUrl(back.id, "photo") : null,
  };
}

/**
 * The bottle that is chosen, only if it is in THIS place's bottles: a choice made in another place, or a bottle
 * that has since been opened, moved or removed, is no choice here.
 */
export function selectedIn(
  selection: { unitId: string; bottleId: string } | null,
  unitId: string,
  placements: readonly Pick<SmartPlacementView, "bottleId">[],
): string | null {
  if (!selection || selection.unitId !== unitId) return null;
  return placements.some((p) => p.bottleId === selection.bottleId) ? selection.bottleId : null;
}
