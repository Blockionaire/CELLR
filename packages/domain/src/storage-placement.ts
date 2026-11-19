import { z } from "zod";
import { DEPTH_PLACEMENT_ENABLED } from "./smart-cellar";
import type { ResolvedStorage } from "./storage-compat";
import { zoneOfRow, type StorageZone } from "./storage-config";
import {
  cellAt,
  checkSlot,
  firstFreeInCell,
  slotKey,
  type SlotAddress,
  type SlotLike,
} from "./storage-layout";
import { STORAGE_LIMITS } from "./storage-templates";

/**
 * PLACING, MOVING AND SWAPPING BOTTLES ON WHOLE SPOTS (Smart Cellar 3D, sprint 4). Pure rules over the domain's own
 * slot identity: a spot is `{ locationId, row, col, index }` (within a place, a `SlotAddress`); no place is `null`.
 * Nothing here writes; the server checks the same rules before it asks the database, and the database (bounds, the
 * unique indexes, the depth switch) stays the final authority.
 *
 * What an index means decides what may be offered:
 * - single:  one spot per cell, index 1.
 * - depth:   a physical position, 1 the front. A spot behind a taken front is not offered (the bottle would have to
 *            pass through it); spots past 1 are not offered while depth placement is off.
 * - ordinal: a counter in a compartment, never a position. The compartment is offered as a whole: its next free
 *            counter (`firstFreeInCell`), with how full it is. No front or back is invented.
 * - unknown: the place's arrangement is not known (resolveStorage: arrangementKnown false). Nothing is offered as a
 *            target there: what a row or a column means in it cannot be established. Bottles may leave it.
 */

// ---- The contract ---------------------------------------------------------------------------------------------------

/** A whole spot, as the Smart Cellar API takes and gives it. */
export const SmartSpotSchema = z.strictObject({
  locationId: z.uuid(),
  row: z.number().int().min(1).max(STORAGE_LIMITS.rows),
  col: z.number().int().min(1).max(STORAGE_LIMITS.cols),
  index: z.number().int().min(1).max(STORAGE_LIMITS.cellCapacity),
});
export type SmartSpot = z.infer<typeof SmartSpotSchema>;

/**
 * A move: from the spot the caller SAW the bottle on (null: it had no place) to where it should go (null: take it
 * off its place). Both whole. The server moves it only while it is still where the caller saw it.
 */
export const SmartMoveSchema = z.strictObject({
  from: SmartSpotSchema.nullable(),
  to: SmartSpotSchema.nullable(),
});
export type SmartMove = z.infer<typeof SmartMoveSchema>;

/** A swap: both bottles, each on the spot the caller saw it on. They trade whole spots, both at once. */
export const SmartSwapSchema = z.strictObject({
  with: z.uuid(),
  expected: z.strictObject({ self: SmartSpotSchema, other: SmartSpotSchema }),
});
export type SmartSwap = z.infer<typeof SmartSwapSchema>;

/** What a successful move answers: where the bottle is now, and where it was (for Undo). */
export interface SmartMoveResult {
  bottleId: string;
  /** "moved", or "already_there": a repeat of a move that had already happened (its first answer was lost). */
  outcome: "moved" | "already_there";
  from: SmartSpot | null;
  to: SmartSpot | null;
}

export interface SmartSwapResult {
  /** The two bottles and the spots they are on now. */
  self: { bottleId: string; spot: SmartSpot };
  other: { bottleId: string; spot: SmartSpot };
}

export const sameSpot = (a: SmartSpot | null, b: SmartSpot | null): boolean =>
  a === null || b === null
    ? a === b
    : a.locationId === b.locationId && a.row === b.row && a.col === b.col && a.index === b.index;

// ---- What an index means here --------------------------------------------------------------------------------------

export type PlacementMeaning = "single" | "depth" | "ordinal" | "unknown";

/** What an index means for placing in this place, truthfully (an unknown arrangement claims nothing). */
export function placementMeaning(resolved: ResolvedStorage): PlacementMeaning {
  if (!resolved.arrangementKnown) return "unknown";
  if (resolved.structure.cellCapacity <= 1) return "single";
  return resolved.layout.semantics;
}

// ---- Spots, as a person placing a bottle sees them -------------------------------------------------------------------

export type SpotState =
  /** A bottle can go here now. */
  | "free"
  /** A bottle is here. */
  | "taken"
  /** The bottle being moved is here now. */
  | "current"
  /** Depth: free, but a bottle in front of it is in the way. Not offered. */
  | "behind"
  /** Past index 1 while depth placement is off. Not offered. */
  | "depth_off"
  /** The place's arrangement is not known: not offered. */
  | "unknown";

export interface SpotChoice {
  address: SlotAddress;
  state: SpotState;
  /** The bottle on it, for taken and current. */
  bottleId: string | null;
}

export interface CellChoice {
  row: number;
  col: number;
  capacity: number;
  used: number;
  free: number;
  meaning: PlacementMeaning;
  /**
   * Single and depth: every spot of the cell, front first. Ordinal: none (a compartment has no spots to point at;
   * see `next`). Unknown: every spot, all "unknown".
   */
  spots: SpotChoice[];
  /** Ordinal: where a bottle put into this compartment goes (its next free counter), or null when it is full. */
  next: SlotAddress | null;
  zone: StorageZone | null;
}

export interface Occupant extends SlotLike {
  bottleId: string;
}

export interface SpotOptions {
  /** The bottle being moved, if it is in this place (its own spot is "current", not "taken"). */
  movingId?: string | null | undefined;
  depthEnabled?: boolean | undefined;
}

/** Every cell of a place with what can be done with it, for a picker (2D) and for marking a target (3D). */
export function cellChoices(
  resolved: ResolvedStorage,
  occupants: readonly Occupant[],
  options: SpotOptions = {},
): CellChoice[] {
  const depthEnabled = options.depthEnabled ?? DEPTH_PLACEMENT_ENABLED;
  const meaning = placementMeaning(resolved);
  const { layout } = resolved;
  const byKey = new Map<string, string>();
  for (const o of occupants) if (checkSlot(layout, o) === null) byKey.set(slotKey(o), o.bottleId);
  // the moving bottle's own spot is free for every other purpose
  const others = occupants.filter((o) => o.bottleId !== options.movingId);
  return layout.cells.map((cell) => {
    const spots: SpotChoice[] = [];
    let used = 0;
    let frontTaken = false;
    for (let index = 1; index <= cell.capacity; index++) {
      const address = { row: cell.row, col: cell.col, index };
      const bottleId = byKey.get(slotKey(address)) ?? null;
      if (bottleId) used++;
      if (meaning === "ordinal") continue;
      let state: SpotState;
      if (meaning === "unknown") state = "unknown";
      else if (bottleId && bottleId === options.movingId) state = "current";
      else if (bottleId) state = "taken";
      else if (index > 1 && !depthEnabled) state = "depth_off";
      else if (meaning === "depth" && frontTaken) state = "behind";
      else state = "free";
      if (bottleId && bottleId !== options.movingId) frontTaken = true;
      spots.push({ address, state, bottleId });
    }
    const next =
      meaning === "ordinal"
        ? (() => {
            const first = firstFreeInCell(layout, others, cell.row, cell.col);
            return first && (first.index === 1 || depthEnabled) ? first : null;
          })()
        : null;
    return {
      row: cell.row,
      col: cell.col,
      capacity: cell.capacity,
      used,
      free: cell.capacity - used,
      meaning,
      spots,
      next,
      zone: zoneOfRow(resolved.structure.zones, cell.row),
    };
  });
}

// ---- Why a target is refused ---------------------------------------------------------------------------------------

export type PlacementProblem =
  /** The place's arrangement is not known: nothing is placed in it. */
  | "unknown_arrangement"
  /** Not a spot of this place (row, column or index outside it). */
  | "out_of_bounds"
  /** More than one bottle per cell, while that is switched off. */
  | "depth_not_enabled"
  /** Another bottle is on that spot. */
  | "occupied"
  /** Depth: a bottle in front of that spot is in the way. */
  | "behind_taken"
  /** Ordinal: the compartment has no room left. */
  | "compartment_full"
  /** The bottle is already there. */
  | "same_spot";

/**
 * Whether a bottle may be put on `target` in this place. `occupants` are the bottles in the place now, including the
 * one being moved if it is there (`movingId`).
 */
export function placementProblem(
  resolved: ResolvedStorage,
  occupants: readonly Occupant[],
  target: SlotLike,
  options: SpotOptions = {},
): PlacementProblem | null {
  const depthEnabled = options.depthEnabled ?? DEPTH_PLACEMENT_ENABLED;
  const meaning = placementMeaning(resolved);
  if (meaning === "unknown") return "unknown_arrangement";
  const address: SlotAddress = { row: target.row, col: target.col, index: target.index ?? 1 };
  if (checkSlot(resolved.layout, address) !== null) return "out_of_bounds";
  if (address.index > 1 && !depthEnabled) return "depth_not_enabled";
  const here = occupants.find((o) => slotKey(o) === slotKey(address));
  if (here && here.bottleId === options.movingId) return "same_spot";
  const others = occupants.filter((o) => o.bottleId !== options.movingId);
  if (meaning === "ordinal") {
    const cell = cellAt(resolved.layout, address.row, address.col)!;
    const inCell = others.filter((o) => o.row === address.row && o.col === address.col).length;
    if (inCell >= cell.capacity) return "compartment_full";
    // a counter that is taken is not a place someone chose: the compartment's next free counter is used instead,
    // and that counter is past 1 (so needs depth) as soon as the compartment holds a bottle
    const next = firstFreeInCell(resolved.layout, others, address.row, address.col);
    if (next && next.index > 1 && !depthEnabled) return "depth_not_enabled";
    return null;
  }
  if (here) return "occupied";
  if (meaning === "depth")
    for (let i = 1; i < address.index; i++)
      if (
        others.some((o) => o.row === address.row && o.col === address.col && (o.index ?? 1) === i)
      )
        return "behind_taken";
  return null;
}

/**
 * Where a bottle put into a compartment goes: an ordinal place's next free counter in that cell; anywhere else the
 * spot itself. Null when nothing there is free.
 */
export function landingSpot(
  resolved: ResolvedStorage,
  occupants: readonly Occupant[],
  target: SlotLike,
  movingId: string | null = null,
): SlotAddress | null {
  const address: SlotAddress = { row: target.row, col: target.col, index: target.index ?? 1 };
  if (placementMeaning(resolved) !== "ordinal") return address;
  const others = occupants.filter((o) => o.bottleId !== movingId);
  return firstFreeInCell(resolved.layout, others, address.row, address.col);
}

// ---- Swaps ---------------------------------------------------------------------------------------------------------

export type SwapProblem =
  | "same_bottle"
  | "unknown_arrangement"
  | "depth_not_enabled"
  /** Two bottles of one compartment whose index is a counter: trading counters moves nothing and means nothing. */
  | "same_compartment";

/** Whether two placed bottles may trade spots. The meaning of each place decides (the database checks it too). */
export function swapProblem(
  a: { bottleId: string; spot: SmartSpot; meaning: PlacementMeaning },
  b: { bottleId: string; spot: SmartSpot; meaning: PlacementMeaning },
  options: { depthEnabled?: boolean | undefined } = {},
): SwapProblem | null {
  const depthEnabled = options.depthEnabled ?? DEPTH_PLACEMENT_ENABLED;
  if (a.bottleId === b.bottleId) return "same_bottle";
  if (a.meaning === "unknown" || b.meaning === "unknown") return "unknown_arrangement";
  if ((a.spot.index > 1 || b.spot.index > 1) && !depthEnabled) return "depth_not_enabled";
  if (
    a.spot.locationId === b.spot.locationId &&
    a.spot.row === b.spot.row &&
    a.spot.col === b.spot.col &&
    a.meaning === "ordinal"
  )
    return "same_compartment";
  return null;
}

// ---- Zones in daily use ------------------------------------------------------------------------------------------------

export interface ZoneSummary extends StorageZone {
  /** 1-based, top first. */
  number: number;
  /** Bottles on the shelves of this zone. */
  bottles: number;
  /** Spots on the shelves of this zone. */
  capacity: number;
}

/**
 * The zones of a place with how many bottles each holds. Only zones the place really has (none: an empty list; a
 * place without zones is never given a temperature). `targetTempC` is what the owner SET, or null: never a reading.
 */
export function zoneSummaries(
  resolved: ResolvedStorage,
  occupants: readonly SlotLike[],
): ZoneSummary[] {
  const { zones, cols, cellCapacity } = resolved.structure;
  return zones.map((zone, i) => ({
    ...zone,
    number: i + 1,
    bottles: occupants.filter((o) => o.row >= zone.fromRow && o.row <= zone.toRow).length,
    capacity: (zone.toRow - zone.fromRow + 1) * cols * cellCapacity,
  }));
}
