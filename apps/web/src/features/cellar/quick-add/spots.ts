import {
  cellChoices,
  placementMeaning,
  type Occupant,
  type ResolvedStorage,
  type SlotAddress,
} from "@cellr/domain";
import type { Pose } from "../storage3d/parts";
import type { RenderModel } from "../storage3d/model";

/**
 * WHERE A NEW BOTTLE CAN GO, AND WHERE THAT IS IN THE PICTURE (Smart Cellar 3D, sprint 7: 3D Quick Add).
 *
 * The free spots come from the domain's own eligibility (`cellChoices`, the rule the server applies to a move), never
 * from the rectangle of rows × columns: a diamond bin has no corners, a spot behind a bottle is not free, and a spot
 * past index 1 needs depth, which is off. Only index 1 is ever offered.
 *
 * A spot can be pointed at in 3D only where the picture has an exact place for it (`poseOf`: racks, shelves,
 * cabinets, coolers, pegs, rails), or where a compartment holds exactly one bottle, so "the next one in it" is one
 * unambiguous place (crates at one per compartment). Anywhere else (a bin of several, a neutral picture of an unknown
 * arrangement) the picture does not say where a bottle would lie, so the accessible 2D spot list is used instead.
 */
export interface FreeSpot {
  row: number;
  col: number;
  index: 1;
}

/** The free spots of a place, as the server would accept a bottle there now (index 1; depth is off). */
export function freeSpots(resolved: ResolvedStorage, occupants: readonly Occupant[]): FreeSpot[] {
  const meaning = placementMeaning(resolved);
  if (meaning === "unknown") return [];
  const out: FreeSpot[] = [];
  for (const cell of cellChoices(resolved, occupants)) {
    if (meaning === "ordinal") {
      // a compartment's next counter is the server's choice; offered only while that counter is the first one
      if (cell.next && cell.next.index === 1) out.push({ row: cell.row, col: cell.col, index: 1 });
      continue;
    }
    for (const spot of cell.spots)
      if (spot.state === "free" && spot.address.index === 1)
        out.push({ row: spot.address.row, col: spot.address.col, index: 1 });
  }
  return out;
}

export interface SpotMarker {
  spot: FreeSpot;
  pose: Pose;
}

/**
 * Where each free spot is in the picture, with the same pose a bottle put there would have; or null when this place
 * cannot be pointed at in 3D (use the 2D spot list). Never a guess: a spot without an exact pose makes the whole place
 * a list, so a person never taps one thing and gets another.
 */
export function spotMarkers(model: RenderModel, spots: readonly FreeSpot[]): SpotMarker[] | null {
  if (model.renderer === "legacy" || model.renderer === "neutral") return null;
  const meaning = placementMeaning(model.resolved);
  if (meaning === "unknown") return null;
  const { poseOf, pileOf } = model.built;
  if (poseOf) return spots.map((spot) => ({ spot, pose: poseOf(spot.row, spot.col, spot.index) }));
  // a compartment that holds one bottle (crates at one per compartment): the first in it is its one place, exactly
  // where placeBottles draws a bottle there
  const single = model.resolved.layout.cells.every((c) => c.capacity === 1);
  if (pileOf && single) return spots.map((spot) => ({ spot, pose: pileOf(spot.row, spot.col, 0) }));
  return null;
}

export const spotKey = (s: Pick<SlotAddress, "row" | "col" | "index">) =>
  `${s.row}:${s.col}:${s.index}`;
