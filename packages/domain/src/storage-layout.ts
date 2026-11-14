import type { LayoutFamily, SlotSemantics } from "./storage-templates";

/**
 * THE LOGICAL LAYOUT OF A PLACE (Smart Cellar 3D, sprint 1A): which spots exist, how many bottles each cell holds,
 * which are taken and which come next. Plain numbers only: nothing here knows how a place is drawn, and nothing
 * here assumes two cells are the same size or shape (a layout is a list of cells, each with its own capacity).
 *
 * A spot is `(row, col, index)`, all counted from 1:
 * - `row`, `col` name the CELL: a position on a shelf, a compartment, a peg. This is the pair the app has always
 *   stored (bottles.loc_row / loc_col), and it keeps its meaning.
 * - `index` is the position WITHIN the cell. What it means depends on the layout's `semantics` (see SlotSemantics):
 *   a physical depth in a rack, a mere counter in a bin, always 1 where a cell holds one bottle.
 * A spot written without an index is index 1: every bottle placed before depth existed is exactly there.
 */
export interface SlotAddress {
  row: number;
  col: number;
  index: number;
}

/** A spot as callers may hand it in: with its index, or the older two-coordinate form (then index 1). */
export interface SlotLike {
  row: number;
  col: number;
  index?: number | undefined;
}

export interface LayoutCell {
  row: number;
  col: number;
  /** How many bottles this cell holds: its valid indexes are 1..capacity. */
  capacity: number;
}

export interface LogicalLayout {
  family: LayoutFamily;
  semantics: SlotSemantics;
  /** The grid the cells sit in (the highest row and column there can be). Not every (row, col) need be a cell. */
  rows: number;
  cols: number;
  /** Every cell, by row then column. */
  cells: readonly LayoutCell[];
  /** The sum of the cells' capacities. */
  capacity: number;
}

// ---- Identity -----------------------------------------------------------------------------------------------------

/** The same spot with its index spelled out (a two-coordinate spot is index 1). */
export const toSlotAddress = (slot: SlotLike): SlotAddress => ({
  row: slot.row,
  col: slot.col,
  index: slot.index ?? 1,
});

/**
 * One spot, one key, within a place: "row:col:index". Always all three, so the key of a spot never depends on who
 * wrote it down. (With the place's id in front it is unique in a household.)
 */
export const slotKey = (slot: SlotLike): string => `${slot.row}:${slot.col}:${slot.index ?? 1}`;

/** Reads a key back. "2:3" (the form used before depth existed) is "2:3:1". Anything else is null. */
export function parseSlotKey(key: string): SlotAddress | null {
  const match = /^([1-9]\d{0,3}):([1-9]\d{0,3})(?::([1-9]\d{0,3}))?$/.exec(key);
  if (!match) return null;
  return { row: Number(match[1]), col: Number(match[2]), index: Number(match[3] ?? "1") };
}

export const sameSlot = (a: SlotLike, b: SlotLike): boolean =>
  a.row === b.row && a.col === b.col && (a.index ?? 1) === (b.index ?? 1);

/** The one order spots are listed in everywhere: shelf by shelf from the top, left to right, index 1 first. */
export const compareSlots = (a: SlotLike, b: SlotLike): number =>
  a.row - b.row || a.col - b.col || (a.index ?? 1) - (b.index ?? 1);

// ---- Building a layout --------------------------------------------------------------------------------------------

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1;
const cellKey = (row: number, col: number) => `${row}:${col}`;

/**
 * A layout from its cells, in any order. Null when the cells do not make one: a cell named twice, a row, column or
 * capacity that is not a whole number from 1, or more than one bottle in a cell of a `single` layout.
 */
export function createLayout(spec: {
  family: LayoutFamily;
  semantics: SlotSemantics;
  cells: readonly LayoutCell[];
}): LogicalLayout | null {
  const seen = new Set<string>();
  let rows = 0;
  let cols = 0;
  let capacity = 0;
  for (const cell of spec.cells) {
    if (!isCount(cell.row) || !isCount(cell.col) || !isCount(cell.capacity)) return null;
    if (spec.semantics === "single" && cell.capacity !== 1) return null;
    const key = cellKey(cell.row, cell.col);
    if (seen.has(key)) return null;
    seen.add(key);
    rows = Math.max(rows, cell.row);
    cols = Math.max(cols, cell.col);
    capacity += cell.capacity;
  }
  const cells = spec.cells
    .map((c) => ({ row: c.row, col: c.col, capacity: c.capacity }))
    .sort((a, b) => a.row - b.row || a.col - b.col);
  return { family: spec.family, semantics: spec.semantics, rows, cols, cells, capacity };
}

/**
 * The layout of a place whose cells are all alike: `rows` shelves of `cols` cells, each holding `cellCapacity`.
 * Sizes that are not whole numbers from 1 give a place with no cells (nothing fits, nothing is valid), never an
 * error: what is stored decides, and this only describes it.
 */
export function uniformLayout(spec: {
  family: LayoutFamily;
  semantics: SlotSemantics;
  rows: number;
  cols: number;
  cellCapacity: number;
}): LogicalLayout {
  const { family, semantics } = spec;
  const sane =
    isCount(spec.rows) &&
    isCount(spec.cols) &&
    isCount(spec.cellCapacity) &&
    (semantics !== "single" || spec.cellCapacity === 1);
  if (!sane) return { family, semantics, rows: 0, cols: 0, cells: [], capacity: 0 };
  const cells: LayoutCell[] = [];
  for (let row = 1; row <= spec.rows; row++)
    for (let col = 1; col <= spec.cols; col++)
      cells.push({ row, col, capacity: spec.cellCapacity });
  return {
    family,
    semantics,
    rows: spec.rows,
    cols: spec.cols,
    cells,
    capacity: spec.rows * spec.cols * spec.cellCapacity,
  };
}

// ---- Looking a spot up --------------------------------------------------------------------------------------------

/** Each layout's cells by "row:col", worked out once per layout object (a layout is never changed in place). */
const indexes = new WeakMap<LogicalLayout, Map<string, LayoutCell>>();
function cellsOf(layout: LogicalLayout): Map<string, LayoutCell> {
  let map = indexes.get(layout);
  if (!map) {
    map = new Map(layout.cells.map((c) => [cellKey(c.row, c.col), c]));
    indexes.set(layout, map);
  }
  return map;
}

/** The cell at (row, col), or null when the layout has none there. */
export const cellAt = (layout: LogicalLayout, row: number, col: number): LayoutCell | null =>
  cellsOf(layout).get(cellKey(row, col)) ?? null;

/** Why a spot is not one of this layout's, in the order it is checked. */
export type SlotProblem = "not_a_position" | "no_such_cell" | "index_out_of_range";

/** Null when the spot exists in this layout; else what is wrong with it. */
export function checkSlot(layout: LogicalLayout, slot: SlotLike): SlotProblem | null {
  const { row, col, index } = toSlotAddress(slot);
  if (!isCount(row) || !isCount(col) || !isCount(index)) return "not_a_position";
  const cell = cellAt(layout, row, col);
  if (!cell) return "no_such_cell";
  return index > cell.capacity ? "index_out_of_range" : null;
}

export const isValidSlot = (layout: LogicalLayout, slot: SlotLike): boolean =>
  checkSlot(layout, slot) === null;

/** Every spot of the layout, in the one order (see compareSlots). As many entries as the layout's capacity. */
export function enumerateSlots(layout: LogicalLayout): SlotAddress[] {
  const out: SlotAddress[] = [];
  for (const cell of layout.cells)
    for (let index = 1; index <= cell.capacity; index++)
      out.push({ row: cell.row, col: cell.col, index });
  return out;
}

// ---- Occupancy ----------------------------------------------------------------------------------------------------

export interface Occupancy {
  capacity: number;
  /** Distinct spots of this layout that are taken. */
  used: number;
  free: number;
  /**
   * Taken spots that are NOT in this layout (each once, in order). Empty for sound data. Asked of a layout a place
   * is about to change INTO, it is the list of bottles that would lose their spot: the change must be refused
   * while it is not empty.
   */
  stranded: SlotAddress[];
  /** Spots claimed more than once (each once, in order). Empty for sound data: one bottle per spot. */
  doubled: SlotAddress[];
}

/** The valid taken spots as keys, plus what does not fit. Shared by everything that reads occupancy. */
function tally(layout: LogicalLayout, occupied: Iterable<SlotLike>) {
  const taken = new Set<string>();
  const stranded = new Map<string, SlotAddress>();
  const doubled = new Map<string, SlotAddress>();
  for (const slot of occupied) {
    const address = toSlotAddress(slot);
    const key = slotKey(address);
    if (!isValidSlot(layout, address)) stranded.set(key, address);
    else if (taken.has(key)) doubled.set(key, address);
    else taken.add(key);
  }
  return { taken, stranded, doubled };
}

export function occupancyOf(layout: LogicalLayout, occupied: Iterable<SlotLike>): Occupancy {
  const { taken, stranded, doubled } = tally(layout, occupied);
  return {
    capacity: layout.capacity,
    used: taken.size,
    free: layout.capacity - taken.size,
    stranded: [...stranded.values()].sort(compareSlots),
    doubled: [...doubled.values()].sort(compareSlots),
  };
}

export interface CellOccupancy extends LayoutCell {
  used: number;
  free: number;
}

/**
 * How full each cell is, in layout order. For a bin this is the truth there is to tell ("5 of 9"): which of its
 * indexes are taken is bookkeeping, not a place in the bin.
 */
export function cellOccupancy(
  layout: LogicalLayout,
  occupied: Iterable<SlotLike>,
): CellOccupancy[] {
  const { taken } = tally(layout, occupied);
  const used = new Map<string, number>();
  for (const key of taken) {
    const cell = key.slice(0, key.lastIndexOf(":"));
    used.set(cell, (used.get(cell) ?? 0) + 1);
  }
  return layout.cells.map((c) => {
    const n = used.get(cellKey(c.row, c.col)) ?? 0;
    return { ...c, used: n, free: c.capacity - n };
  });
}

// ---- The next free spots ------------------------------------------------------------------------------------------

/**
 * The first `count` free spots in the one order: shelf by shelf from the top, left to right, and within a cell
 * index 1 first (a lone bottle lies at the front, where it is seen; the next one of a cell goes behind it). Fewer
 * when less is free. For a place with one position per cell this is exactly `nextFreeSlots`.
 */
export function nextFreeAddresses(
  layout: LogicalLayout,
  occupied: Iterable<SlotLike>,
  count: number,
): SlotAddress[] {
  const { taken } = tally(layout, occupied);
  const free: SlotAddress[] = [];
  for (const cell of layout.cells) {
    for (let index = 1; index <= cell.capacity; index++) {
      if (free.length >= count) return free;
      const address = { row: cell.row, col: cell.col, index };
      if (!taken.has(slotKey(address))) free.push(address);
    }
  }
  return free;
}

/**
 * Spots for `count` new bottles: the first on `first` when one is asked for, the rest on the next free ones. Null
 * when `first` is not a spot of this layout or is taken: the caller says so, the bottle never goes somewhere else.
 * Without `first` it is exactly `nextFreeAddresses`. (The same contract as `slotsFor`, with an index.)
 */
export function addressesFor(
  layout: LogicalLayout,
  occupied: Iterable<SlotLike>,
  count: number,
  first?: SlotLike | null,
): SlotAddress[] | null {
  if (!first) return nextFreeAddresses(layout, occupied, count);
  const taken = [...occupied];
  const wanted = toSlotAddress(first);
  if (!isValidSlot(layout, wanted)) return null;
  if (taken.some((s) => sameSlot(s, wanted))) return null;
  if (count < 1) return [];
  return [wanted, ...nextFreeAddresses(layout, [...taken, wanted], count - 1)];
}

/**
 * The spot a bottle put "in this cell" gets: the cell's lowest free index, or null when the cell is full or is not
 * a cell. This is how a compartment is filled: a person chooses the bin, never the index.
 */
export function firstFreeInCell(
  layout: LogicalLayout,
  occupied: Iterable<SlotLike>,
  row: number,
  col: number,
): SlotAddress | null {
  const cell = cellAt(layout, row, col);
  if (!cell) return null;
  const { taken } = tally(layout, occupied);
  for (let index = 1; index <= cell.capacity; index++) {
    const address = { row, col, index };
    if (!taken.has(slotKey(address))) return address;
  }
  return null;
}
