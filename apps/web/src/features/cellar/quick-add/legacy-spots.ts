import {
  STORAGE_KINDS,
  placementMeaning,
  type ResolvedStorage,
  type StorageKind,
} from "@cellr/domain";
import { slotPosition } from "../three/layout";
import type { FreeSpot } from "./spots";

/**
 * 3D QUICK ADD ON A PLACE FROM BEFORE TEMPLATES (Smart Cellar 3D, sprint 7.2 completion).
 *
 * A place without a template is drawn by the EXISTING 3D view (`cellar-3d-view.tsx`, `three/scene.tsx`), never by the
 * template renderer (README rules 5, 11 and 17), and nothing here gives it a template. That view has one fixed,
 * deterministic place for every spot, pinned by `three/legacy-parity.test.ts`: spot (row, col) of a rows × cols place
 * is `slotPosition(row, col, rows, cols)`, the bottle lying there neck-forward (`rackMatrix`). Where that is exactly
 * the spot the server would put a bottle on, a free spot can be shown and tapped in the picture, as on a place with a
 * template; anywhere else the accessible 2D list stays the way in, and the bar says so.
 *
 * WHICH LEGACY PLACES GET DIRECT INTERACTION, AND WHY.
 *   - Every kind the app knows: rack, cabinet, shelving, fridge, wall, other. The existing view draws all six the same
 *     way, a rows × cols grid with one bottle per spot at `slotPosition`; the kind only chooses materials, boards and
 *     dividers (`STORAGE_LOOK`). So a placeholder at `slotPosition(row, col)` is exactly where a bottle put on that
 *     spot is then drawn, whatever the kind.
 *   - Only while the domain reads the place as from before templates (`resolved.legacy`: no template, one bottle per
 *     cell), with nothing in it read differently from what is stored (`fallbacks` empty), each spot one place
 *     (`placementMeaning` is "single"), and the layout a whole rows × cols grid of one-bottle cells.
 *
 * WHICH DO NOT (the 2D list, as before):
 *   - a stored kind the app does not know (read as "other": `unknown_kind`), a size or a cell capacity outside what
 *     the app allows (`size`, `cell_capacity`), or any other fallback: what is drawn may then not be what is stored;
 *   - a place without a template that holds more than one bottle per cell (a pile, a bin from before templates): the
 *     domain does not say where in the cell a bottle lies (`arrangementKnown` false, not `legacy`; drawn by the neutral
 *     picture, which points at nothing);
 *   - a place whose two reads disagree: the existing view draws the racks read, the free spots come from the Smart
 *     Cellar read; another size or kind, or a drawn bottle on a spot the other read calls free, and nothing is pointed
 *     at until both say the same;
 *   - any free spot outside the drawn grid, or past index 1 (depth is off): the whole place is a list, never a guess.
 */

/** What the existing view draws for this place (from the racks read). */
export interface LegacyDrawn {
  rows: number;
  cols: number;
  kind: string;
  /** The spots it draws a bottle on. */
  taken: ReadonlyArray<{ row: number; col: number }>;
}

/** A free spot in the existing view: the spot, and the centre of the bottle that would lie there. */
export interface LegacySpot {
  spot: FreeSpot;
  position: [number, number, number];
}

export type LegacyRefusal =
  | "not_legacy"
  | "fallback"
  | "unknown_kind"
  | "not_single"
  | "not_a_grid"
  | "reads_differ"
  | "spot_outside";

export type LegacyPointing =
  | { ok: true; rows: number; cols: number; spots: LegacySpot[] }
  | { ok: false; reason: LegacyRefusal };

const KINDS: readonly string[] = STORAGE_KINDS;

/**
 * Where each free spot of a place from before templates is in the existing 3D view, or why it cannot be pointed at.
 * `free` are the domain's own free spots (`freeSpots`: the server's eligibility, index 1 only).
 */
export function legacyPointing(
  resolved: ResolvedStorage,
  drawn: LegacyDrawn,
  free: readonly FreeSpot[],
): LegacyPointing {
  if (!resolved.legacy) return { ok: false, reason: "not_legacy" };
  if (resolved.fallbacks.length > 0) return { ok: false, reason: "fallback" };
  if (!KINDS.includes(drawn.kind)) return { ok: false, reason: "unknown_kind" };
  if (placementMeaning(resolved) !== "single") return { ok: false, reason: "not_single" };
  const { rows, cols } = resolved.structure;
  const { layout } = resolved;
  // a whole rows × cols grid of one-bottle cells, each once: what the existing view draws
  const cells = new Set<string>();
  for (const c of layout.cells) {
    if (c.capacity !== 1 || c.row < 1 || c.row > rows || c.col < 1 || c.col > cols)
      return { ok: false, reason: "not_a_grid" };
    cells.add(`${c.row}:${c.col}`);
  }
  if (layout.rows !== rows || layout.cols !== cols || cells.size !== rows * cols)
    return { ok: false, reason: "not_a_grid" };
  // the existing view draws the same place
  if (
    drawn.rows !== rows ||
    drawn.cols !== cols ||
    (drawn.kind as StorageKind) !== resolved.template.kind
  )
    return { ok: false, reason: "reads_differ" };
  const drawnTaken = new Set(drawn.taken.map((t) => `${t.row}:${t.col}`));
  const spots: LegacySpot[] = [];
  for (const spot of free) {
    if (spot.index !== 1 || !cells.has(`${spot.row}:${spot.col}`))
      return { ok: false, reason: "spot_outside" };
    if (drawnTaken.has(`${spot.row}:${spot.col}`)) return { ok: false, reason: "reads_differ" };
    spots.push({ spot, position: slotPosition(spot.row, spot.col, rows, cols) });
  }
  return { ok: true, rows, cols, spots };
}
