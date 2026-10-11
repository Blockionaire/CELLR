export interface GridSize {
  rows: number;
  cols: number;
}

/** A spot in a storage unit. 1-based: shelf 1 position 1 is the top-left. */
export interface Slot {
  row: number;
  col: number;
}

/**
 * The first `count` free spots, filling shelf by shelf from the top-left. If the unit has less room
 * than asked for, you get what fits (the caller decides what to do about the rest).
 */
export function nextFreeSlots(grid: GridSize, occupied: Iterable<Slot>, count: number): Slot[] {
  const taken = new Set<string>();
  for (const s of occupied) taken.add(`${s.row}:${s.col}`);
  const free: Slot[] = [];
  for (let row = 1; row <= grid.rows && free.length < count; row++) {
    for (let col = 1; col <= grid.cols && free.length < count; col++) {
      if (!taken.has(`${row}:${col}`)) free.push({ row, col });
    }
  }
  return free;
}

/** "Shelf 2 · Position 4" — the words people use, never row/column. */
export const describeSlot = (slot: Slot): string => `Shelf ${slot.row} · Position ${slot.col}`;
