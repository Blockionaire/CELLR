import {
  checkSlot,
  compareSlots,
  slotKey,
  type ResolvedStorage,
  type WineType,
} from "@cellr/domain";

/**
 * A place as a flat picture, in data (Smart Cellar 3D, sprint 2A): for every cell of the logical layout, what there
 * is to say about it. Read-only. The same `LogicalLayout` the 3D view draws from; nothing about spots is decided
 * here either.
 */
export interface MapBottle {
  id: string;
  row: number;
  col: number;
  /** Absent: 1. */
  index?: number | undefined;
  type: WineType;
  /** What to call it: "Domaine du Lac Les Pierres 2018". */
  name: string;
}

/**
 * How a cell may be shown, which is how much is KNOWN about where its bottles are:
 * - `position`: one bottle, one place.
 * - `depth`: several places one behind the other; `slots[0]` is the front. Which bottle is where is known.
 * - `count`: a compartment. How many are in it is known; where each one lies in it is not, and must not be drawn
 *   or said as if it were. Also every place whose arrangement the app does not know, whatever is stored about it.
 */
export type CellMode = "position" | "depth" | "count";

export interface MapCell {
  row: number;
  col: number;
  capacity: number;
  mode: CellMode;
  used: number;
  /** The bottles of the cell, by their stored index. In a `count` cell that order means nothing to a person. */
  bottles: MapBottle[];
  /** `position` and `depth` only: the bottle on each index (front first), or null where there is none. */
  slots: Array<MapBottle | null> | null;
}

export interface MapData {
  rows: number;
  cols: number;
  mode: CellMode;
  /** By row then column, as the layout lists its cells. A place need not have a cell at every (row, col). */
  cells: MapCell[];
  capacity: number;
  used: number;
  /** Bottles stored on a spot the layout does not have. Listed, never put on some other spot. */
  stranded: MapBottle[];
}

export function modeOf(resolved: ResolvedStorage): CellMode {
  if (!resolved.arrangementKnown || resolved.layout.semantics === "ordinal") return "count";
  return resolved.layout.cells.some((c) => c.capacity > 1) ? "depth" : "position";
}

export function mapData(resolved: ResolvedStorage, bottles: readonly MapBottle[]): MapData {
  const { layout } = resolved;
  const mode = modeOf(resolved);
  const perCell = new Map<string, MapBottle[]>();
  const stranded: MapBottle[] = [];
  const seen = new Set<string>();
  for (const b of bottles) {
    const address = { row: b.row, col: b.col, index: b.index ?? 1 };
    const key = slotKey(address);
    if (checkSlot(layout, address) !== null || seen.has(key)) {
      stranded.push(b);
      continue;
    }
    seen.add(key);
    const cell = `${b.row}:${b.col}`;
    perCell.set(cell, [...(perCell.get(cell) ?? []), b]);
  }
  const cells = layout.cells.map((c): MapCell => {
    const here = (perCell.get(`${c.row}:${c.col}`) ?? []).sort((a, b) =>
      compareSlots({ ...a, index: a.index ?? 1 }, { ...b, index: b.index ?? 1 }),
    );
    return {
      row: c.row,
      col: c.col,
      capacity: c.capacity,
      mode,
      used: here.length,
      bottles: here,
      slots:
        mode === "count"
          ? null
          : Array.from(
              { length: c.capacity },
              (_, i) => here.find((b) => (b.index ?? 1) === i + 1) ?? null,
            ),
    };
  });
  return {
    rows: layout.rows,
    cols: layout.cols,
    mode,
    cells,
    capacity: layout.capacity,
    used: cells.reduce((n, c) => n + c.used, 0),
    stranded,
  };
}

/** The words of the flat picture. English here; the screens that use it in the app pass their own. */
export interface MapLabels {
  empty: (row: number, col: number) => string;
  position: (row: number, col: number, wine: string) => string;
  depth: (row: number, col: number, parts: string[]) => string;
  /** `chosen`: this is the place of the bottle that is chosen right now. */
  depthPart: (place: number, of: number, wine: string | null, chosen: boolean) => string;
  count: (row: number, col: number, used: number, capacity: number) => string;
  unknownNote: string;
  countNote: string;
  depthNote: string;
  stranded: (n: number) => string;
  summary: (used: number, capacity: number) => string;
}

export const MAP_LABELS_EN: MapLabels = {
  empty: (row, col) => `Shelf ${row}, position ${col}: free`,
  position: (row, col, wine) => `Shelf ${row}, position ${col}: ${wine}`,
  depth: (row, col, parts) => `Shelf ${row}, position ${col}: ${parts.join("; ")}`,
  depthPart: (place, of, wine, chosen) =>
    `${place === 1 ? "front" : place === of ? "back" : `place ${place} from the front`}: ${wine ?? "free"}${chosen ? " (chosen)" : ""}`,
  count: (row, col, used, capacity) => `Compartment ${row}·${col}: ${used} of ${capacity} bottles`,
  unknownNote:
    "CELLR does not know how this place is arranged. It shows which compartments there are and how many bottles are in each, not where in a compartment a bottle is.",
  depthNote:
    "Large circle: the bottle at the front. Small dots beside it: the places behind it, front to back. Choosing a position chooses its front bottle only.",
  countNote:
    "A compartment holds a loose pile: how many bottles are in it is shown, not where each one lies.",
  stranded: (n) =>
    `${n} ${n === 1 ? "bottle is" : "bottles are"} stored on a spot this place does not have`,
  summary: (used, capacity) => `${used} of ${capacity} spots taken`,
};

/**
 * The bottle a cell stands for when it is pressed: the one at the FRONT (index 1), and only that one. A position
 * whose front is free stands for no bottle, however many lie behind it: the picture shows the front as free and
 * says so, and pressing it must not quietly reach past that to a bottle the person did not point at. A compartment
 * stands for no bottle either (it has no "the bottle here").
 */
export function frontOf(cell: MapCell): MapBottle | null {
  return cell.mode === "count" ? null : (cell.slots![0] ?? null);
}

/** What is chosen after a cell is pressed: its front bottle, or nothing (also when that bottle was chosen already). */
export function chosenByPressing(cell: MapCell, selectedId: string | null): string | null {
  const front = frontOf(cell);
  return front && front.id !== selectedId ? front.id : null;
}

/**
 * Which place of a cell holds the chosen bottle (1 = the front), or null. A bottle behind the front can be chosen
 * elsewhere (in the 3D view, where it can be pointed at); the flat picture then shows which one it is.
 */
export function chosenPlace(cell: MapCell, selectedId: string | null): number | null {
  if (selectedId === null || cell.mode === "count") return null;
  const at = cell.slots!.findIndex((b) => b?.id === selectedId);
  return at < 0 ? null : at + 1;
}

/** What a screen reader says for a cell. `selectedId`: the chosen bottle, so a deep cell can say which place it is. */
export function cellLabel(
  cell: MapCell,
  labels: MapLabels,
  selectedId: string | null = null,
): string {
  if (cell.mode === "count") return labels.count(cell.row, cell.col, cell.used, cell.capacity);
  const slots = cell.slots!;
  if (cell.mode === "position")
    return slots[0]
      ? labels.position(cell.row, cell.col, slots[0].name)
      : labels.empty(cell.row, cell.col);
  return labels.depth(
    cell.row,
    cell.col,
    slots.map((b, i) =>
      labels.depthPart(i + 1, slots.length, b?.name ?? null, b !== null && b.id === selectedId),
    ),
  );
}
