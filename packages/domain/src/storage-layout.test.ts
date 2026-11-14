import { describe, expect, it } from "vitest";
import {
  addressesFor,
  cellAt,
  cellOccupancy,
  checkSlot,
  compareSlots,
  createLayout,
  enumerateSlots,
  firstFreeInCell,
  isValidSlot,
  nextFreeAddresses,
  occupancyOf,
  parseSlotKey,
  sameSlot,
  slotKey,
  toSlotAddress,
  uniformLayout,
  type LogicalLayout,
  type SlotAddress,
} from "./storage-layout";

/** A seeded random (mulberry32): the same "random" cases on every run, so a failure can be found again. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (rnd: () => number, min: number, max: number) =>
  min + Math.floor(rnd() * (max - min + 1));
function shuffled<T>(rnd: () => number, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(rnd, 0, i);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const rack = (rows: number, cols: number, cellCapacity = 1) =>
  uniformLayout({ family: "grid", semantics: "depth", rows, cols, cellCapacity });
const bins = (rows: number, cols: number, cellCapacity: number) =>
  uniformLayout({ family: "bins", semantics: "ordinal", rows, cols, cellCapacity });

/** A place whose cells are NOT alike: a wide top shelf, a gap, a deep cell, a big bin at the bottom. */
const uneven = createLayout({
  family: "bins",
  semantics: "ordinal",
  cells: [
    { row: 3, col: 1, capacity: 12 },
    { row: 1, col: 1, capacity: 1 },
    { row: 1, col: 2, capacity: 1 },
    { row: 1, col: 4, capacity: 2 },
    { row: 2, col: 2, capacity: 3 },
  ],
})!;

describe("a spot's identity", () => {
  it("is row, cell and index; a spot without an index is index 1", () => {
    expect(toSlotAddress({ row: 2, col: 3 })).toEqual({ row: 2, col: 3, index: 1 });
    expect(toSlotAddress({ row: 2, col: 3, index: 2 })).toEqual({ row: 2, col: 3, index: 2 });
    expect(slotKey({ row: 2, col: 3 })).toBe("2:3:1");
    expect(slotKey({ row: 2, col: 3, index: 1 })).toBe("2:3:1");
    expect(slotKey({ row: 2, col: 3, index: 4 })).toBe("2:3:4");
    expect(sameSlot({ row: 2, col: 3 }, { row: 2, col: 3, index: 1 })).toBe(true);
    expect(sameSlot({ row: 2, col: 3 }, { row: 2, col: 3, index: 2 })).toBe(false);
  });

  it("never gives two spots the same key (11:1 is not 1:11)", () => {
    const keys = new Set<string>();
    for (let row = 1; row <= 30; row++)
      for (let col = 1; col <= 30; col++)
        for (let index = 1; index <= 16; index++) keys.add(slotKey({ row, col, index }));
    expect(keys.size).toBe(30 * 30 * 16);
  });

  it("reads a key back, and the older two-part key as index 1", () => {
    for (const address of enumerateSlots(rack(4, 5, 3)))
      expect(parseSlotKey(slotKey(address))).toEqual(address);
    expect(parseSlotKey("2:3")).toEqual({ row: 2, col: 3, index: 1 });
    for (const junk of [
      "",
      "2",
      "2:3:4:5",
      "0:1:1",
      "1:0",
      "1:1:0",
      "-1:2:1",
      "a:b:c",
      "1.5:2:1",
      " 1:2:1",
      "01:2:1",
    ])
      expect(parseSlotKey(junk)).toBeNull();
  });

  it("orders spots shelf by shelf, left to right, index 1 first", () => {
    const spots: SlotAddress[] = [
      { row: 2, col: 1, index: 1 },
      { row: 1, col: 2, index: 2 },
      { row: 1, col: 2, index: 1 },
      { row: 1, col: 1, index: 3 },
    ];
    expect([...spots].sort(compareSlots).map(slotKey)).toEqual([
      "1:1:3",
      "1:2:1",
      "1:2:2",
      "2:1:1",
    ]);
  });
});

describe("a layout of cells that are all alike", () => {
  it("has rows x cols cells of the same capacity, by row then column", () => {
    const layout = rack(2, 3, 2);
    expect(layout).toMatchObject({
      family: "grid",
      semantics: "depth",
      rows: 2,
      cols: 3,
      capacity: 12,
    });
    expect(layout.cells).toEqual([
      { row: 1, col: 1, capacity: 2 },
      { row: 1, col: 2, capacity: 2 },
      { row: 1, col: 3, capacity: 2 },
      { row: 2, col: 1, capacity: 2 },
      { row: 2, col: 2, capacity: 2 },
      { row: 2, col: 3, capacity: 2 },
    ]);
  });

  it("is empty, not an error, for a size that is not one", () => {
    for (const [rows, cols, cap] of [
      [0, 3, 1],
      [3, 0, 1],
      [3, 3, 0],
      [-1, 3, 1],
      [2.5, 3, 1],
      [Number.NaN, 3, 1],
      [Number.POSITIVE_INFINITY, 3, 1],
    ] as const) {
      const layout = rack(rows, cols, cap);
      expect(layout.cells).toEqual([]);
      expect(layout.capacity).toBe(0);
      expect(enumerateSlots(layout)).toEqual([]);
      expect(nextFreeAddresses(layout, [], 3)).toEqual([]);
      expect(isValidSlot(layout, { row: 1, col: 1 })).toBe(false);
    }
  });

  it("holds one bottle per cell where the semantics is `single`, and refuses to be built otherwise", () => {
    const pegs = uniformLayout({
      family: "wall",
      semantics: "single",
      rows: 3,
      cols: 2,
      cellCapacity: 1,
    });
    expect(pegs.capacity).toBe(6);
    expect(isValidSlot(pegs, { row: 1, col: 1, index: 2 })).toBe(false);
    const wrong = uniformLayout({
      family: "wall",
      semantics: "single",
      rows: 3,
      cols: 2,
      cellCapacity: 2,
    });
    expect(wrong.capacity).toBe(0);
    expect(
      createLayout({
        family: "wall",
        semantics: "single",
        cells: [{ row: 1, col: 1, capacity: 2 }],
      }),
    ).toBeNull();
  });
});

describe("a layout of cells that differ", () => {
  it("keeps each cell's own capacity and sorts the cells", () => {
    expect(uneven.cells.map((c) => `${c.row}:${c.col}x${c.capacity}`)).toEqual([
      "1:1x1",
      "1:2x1",
      "1:4x2",
      "2:2x3",
      "3:1x12",
    ]);
    expect(uneven).toMatchObject({ rows: 3, cols: 4, capacity: 19 });
  });

  it("has no spot where it has no cell, and no index past a cell's own capacity", () => {
    expect(cellAt(uneven, 1, 3)).toBeNull();
    expect(checkSlot(uneven, { row: 1, col: 3 })).toBe("no_such_cell");
    expect(checkSlot(uneven, { row: 2, col: 1 })).toBe("no_such_cell");
    expect(checkSlot(uneven, { row: 1, col: 1, index: 2 })).toBe("index_out_of_range");
    expect(checkSlot(uneven, { row: 1, col: 4, index: 2 })).toBeNull();
    expect(checkSlot(uneven, { row: 3, col: 1, index: 12 })).toBeNull();
    expect(checkSlot(uneven, { row: 3, col: 1, index: 13 })).toBe("index_out_of_range");
  });

  it("lists exactly its own spots, in order", () => {
    const spots = enumerateSlots(uneven);
    expect(spots).toHaveLength(19);
    expect(spots.slice(0, 7).map(slotKey)).toEqual([
      "1:1:1",
      "1:2:1",
      "1:4:1",
      "1:4:2",
      "2:2:1",
      "2:2:2",
      "2:2:3",
    ]);
    expect(spots.at(-1)).toEqual({ row: 3, col: 1, index: 12 });
  });

  it("is refused when the cells do not make a layout", () => {
    const make = (cells: Array<{ row: number; col: number; capacity: number }>) =>
      createLayout({ family: "bins", semantics: "ordinal", cells });
    expect(make([])).toMatchObject({ rows: 0, cols: 0, capacity: 0, cells: [] });
    expect(
      make([
        { row: 1, col: 1, capacity: 2 },
        { row: 1, col: 1, capacity: 3 },
      ]),
    ).toBeNull();
    expect(make([{ row: 0, col: 1, capacity: 2 }])).toBeNull();
    expect(make([{ row: 1, col: 1.5, capacity: 2 }])).toBeNull();
    expect(make([{ row: 1, col: 1, capacity: 0 }])).toBeNull();
    expect(make([{ row: 1, col: 1, capacity: Number.NaN }])).toBeNull();
  });

  it("does not keep hold of the cells it was given", () => {
    const cells = [{ row: 1, col: 1, capacity: 2 }];
    const layout = createLayout({ family: "bins", semantics: "ordinal", cells })!;
    cells[0]!.capacity = 9;
    expect(layout.cells[0]!.capacity).toBe(2);
    expect(layout.capacity).toBe(2);
  });
});

describe("which spots exist (every size up to 6 x 6 x 4, checked spot by spot)", () => {
  it("lists each spot once, in order, and a spot is valid exactly when it is listed", () => {
    let layouts = 0;
    for (let rows = 1; rows <= 6; rows++)
      for (let cols = 1; cols <= 6; cols++)
        for (let cap = 1; cap <= 4; cap++) {
          const layout = rack(rows, cols, cap);
          const spots = enumerateSlots(layout);
          const keys = new Set(spots.map(slotKey));
          expect(spots).toHaveLength(rows * cols * cap);
          expect(spots).toHaveLength(layout.capacity);
          expect(keys.size).toBe(spots.length);
          expect([...spots].sort(compareSlots)).toEqual(spots);
          // every candidate in a box one larger than the place on each side
          for (let row = 0; row <= rows + 1; row++)
            for (let col = 0; col <= cols + 1; col++)
              for (let index = 0; index <= cap + 1; index++)
                expect(isValidSlot(layout, { row, col, index })).toBe(
                  keys.has(slotKey({ row, col, index })),
                );
          layouts++;
        }
    expect(layouts).toBe(144);
  });

  it("says what is wrong with a spot that is not one", () => {
    const layout = rack(2, 3, 2);
    expect(checkSlot(layout, { row: 1, col: 1 })).toBeNull();
    expect(checkSlot(layout, { row: 2, col: 3, index: 2 })).toBeNull();
    expect(checkSlot(layout, { row: 3, col: 1 })).toBe("no_such_cell");
    expect(checkSlot(layout, { row: 1, col: 4 })).toBe("no_such_cell");
    expect(checkSlot(layout, { row: 1, col: 1, index: 3 })).toBe("index_out_of_range");
    for (const bad of [
      { row: 0, col: 1 },
      { row: 1, col: -1 },
      { row: 1.5, col: 1 },
      { row: 1, col: 1, index: 0 },
      { row: 1, col: 1, index: 1.5 },
      { row: Number.NaN, col: 1 },
    ])
      expect(checkSlot(layout, bad)).toBe("not_a_position");
  });

  it("holds at the largest sizes there are", () => {
    const largest = rack(30, 30, 1);
    expect(enumerateSlots(largest)).toHaveLength(900);
    expect(isValidSlot(largest, { row: 30, col: 30 })).toBe(true);
    expect(isValidSlot(largest, { row: 31, col: 30 })).toBe(false);
    const deepest = bins(10, 10, 16);
    expect(enumerateSlots(deepest)).toHaveLength(1600);
    expect(new Set(enumerateSlots(deepest).map(slotKey)).size).toBe(1600);
  });
});

describe("the index means different things", () => {
  const deep = rack(2, 2, 3);
  const pile = bins(2, 2, 3);

  it("the same numbers are the same spots, whatever they mean", () => {
    expect(enumerateSlots(deep)).toEqual(enumerateSlots(pile));
    expect(deep.semantics).toBe("depth");
    expect(pile.semantics).toBe("ordinal");
  });

  it("in a rack an index is a depth: front first, and a bottle may lie behind an empty front", () => {
    // the back one stays where it is when the front one is taken out
    const taken = [{ row: 1, col: 1, index: 2 }];
    expect(occupancyOf(deep, taken).used).toBe(1);
    expect(nextFreeAddresses(deep, taken, 2).map(slotKey)).toEqual(["1:1:1", "1:1:3"]);
    expect(firstFreeInCell(deep, taken, 1, 1)).toEqual({ row: 1, col: 1, index: 1 });
  });

  it("in a bin a person chooses the compartment and gets its lowest free counter", () => {
    const taken = [
      { row: 1, col: 2, index: 1 },
      { row: 1, col: 2, index: 3 },
    ];
    expect(firstFreeInCell(pile, taken, 1, 2)).toEqual({ row: 1, col: 2, index: 2 });
    expect(firstFreeInCell(pile, [...taken, { row: 1, col: 2, index: 2 }], 1, 2)).toBeNull();
    expect(firstFreeInCell(pile, taken, 2, 1)).toEqual({ row: 2, col: 1, index: 1 });
    expect(firstFreeInCell(pile, taken, 3, 1)).toBeNull();
    // what there is to tell about a bin: how full it is
    expect(cellOccupancy(pile, taken)).toEqual([
      { row: 1, col: 1, capacity: 3, used: 0, free: 3 },
      { row: 1, col: 2, capacity: 3, used: 2, free: 1 },
      { row: 2, col: 1, capacity: 3, used: 0, free: 3 },
      { row: 2, col: 2, capacity: 3, used: 0, free: 3 },
    ]);
  });
});

describe("occupancy", () => {
  const layout = rack(2, 3, 2);

  it("counts distinct taken spots against the capacity", () => {
    expect(occupancyOf(layout, [])).toEqual({
      capacity: 12,
      used: 0,
      free: 12,
      stranded: [],
      doubled: [],
    });
    const taken = [
      { row: 1, col: 1 },
      { row: 1, col: 1, index: 2 },
      { row: 2, col: 3, index: 1 },
    ];
    expect(occupancyOf(layout, taken)).toEqual({
      capacity: 12,
      used: 3,
      free: 9,
      stranded: [],
      doubled: [],
    });
  });

  it("reports a spot claimed twice once, and counts it once", () => {
    const o = occupancyOf(layout, [
      { row: 1, col: 1 },
      { row: 1, col: 1, index: 1 },
      { row: 1, col: 1 },
      { row: 1, col: 2 },
    ]);
    expect(o.used).toBe(2);
    expect(o.doubled).toEqual([{ row: 1, col: 1, index: 1 }]);
  });

  it("reports bottles that have no spot in this layout: what a smaller or shallower place would strand", () => {
    const taken = [
      { row: 2, col: 3, index: 2 },
      { row: 1, col: 1, index: 2 },
      { row: 1, col: 2 },
    ];
    expect(occupancyOf(layout, taken).stranded).toEqual([]);
    // one bottle deep instead of two: the two back ones lose their spot
    expect(occupancyOf(rack(2, 3, 1), taken)).toMatchObject({
      used: 1,
      stranded: [
        { row: 1, col: 1, index: 2 },
        { row: 2, col: 3, index: 2 },
      ],
    });
    // one shelf less
    expect(occupancyOf(rack(1, 3, 2), taken).stranded).toEqual([{ row: 2, col: 3, index: 2 }]);
    // growing strands nothing
    expect(occupancyOf(rack(3, 4, 3), taken).stranded).toEqual([]);
  });

  it("adds up per cell to the whole", () => {
    const rnd = seeded(7);
    for (let run = 0; run < 200; run++) {
      const l = bins(int(rnd, 1, 5), int(rnd, 1, 5), int(rnd, 1, 6));
      const all = enumerateSlots(l);
      const taken = shuffled(rnd, all).slice(0, int(rnd, 0, all.length));
      const cells = cellOccupancy(l, taken);
      const whole = occupancyOf(l, taken);
      expect(cells.reduce((s, c) => s + c.used, 0)).toBe(whole.used);
      expect(cells.reduce((s, c) => s + c.free, 0)).toBe(whole.free);
      expect(whole.used).toBe(taken.length);
      for (const c of cells) expect(c.used + c.free).toBe(c.capacity);
    }
  });
});

describe("the next free spots", () => {
  it("fills shelf by shelf, and each cell front to back before the next", () => {
    expect(nextFreeAddresses(rack(2, 2, 2), [], 5).map(slotKey)).toEqual([
      "1:1:1",
      "1:1:2",
      "1:2:1",
      "1:2:2",
      "2:1:1",
    ]);
  });

  it("gives what fits, nothing for a count below one, and never a taken spot", () => {
    const layout = rack(1, 2, 2);
    const taken = [
      { row: 1, col: 1 },
      { row: 1, col: 2, index: 2 },
    ];
    expect(nextFreeAddresses(layout, taken, 9).map(slotKey)).toEqual(["1:1:2", "1:2:1"]);
    expect(nextFreeAddresses(layout, taken, 0)).toEqual([]);
    expect(nextFreeAddresses(layout, taken, -3)).toEqual([]);
    expect(nextFreeAddresses(layout, enumerateSlots(layout), 1)).toEqual([]);
  });

  it("skips cells that do not exist and fills each cell to its own capacity", () => {
    expect(nextFreeAddresses(uneven, [{ row: 1, col: 2 }], 6).map(slotKey)).toEqual([
      "1:1:1",
      "1:4:1",
      "1:4:2",
      "2:2:1",
      "2:2:2",
      "2:2:3",
    ]);
  });

  /** Whatever the place and whatever is taken: the result is the first free spots of the list, and only those. */
  function holds(layout: LogicalLayout, rnd: () => number) {
    const all = enumerateSlots(layout);
    const taken = shuffled(rnd, all).slice(0, int(rnd, 0, all.length));
    const count = int(rnd, 0, all.length + 2);
    const takenKeys = new Set(taken.map(slotKey));
    const expected = all.filter((s) => !takenKeys.has(slotKey(s))).slice(0, count);
    const got = nextFreeAddresses(layout, taken, count);
    expect(got).toEqual(expected);
    expect(got).toHaveLength(Math.min(count, all.length - taken.length));
    expect(new Set(got.map(slotKey)).size).toBe(got.length);
    for (const s of got) {
      expect(isValidSlot(layout, s)).toBe(true);
      expect(takenKeys.has(slotKey(s))).toBe(false);
    }
    // the same question asked again, with the taken spots in another order, has the same answer
    expect(nextFreeAddresses(layout, shuffled(rnd, taken), count)).toEqual(got);
    // filling them all leaves exactly the rest free
    expect(occupancyOf(layout, [...taken, ...got]).free).toBe(
      all.length - taken.length - got.length,
    );
  }

  it("is the first free spots of the list, for 600 random places and occupancies", () => {
    const rnd = seeded(20261114);
    for (let run = 0; run < 300; run++)
      holds(rack(int(rnd, 1, 8), int(rnd, 1, 8), int(rnd, 1, 3)), rnd);
    for (let run = 0; run < 300; run++)
      holds(bins(int(rnd, 1, 5), int(rnd, 1, 5), int(rnd, 1, 16)), rnd);
    for (let run = 0; run < 50; run++) holds(uneven, rnd);
  });

  it("ignores taken spots that are not in the layout", () => {
    const layout = rack(1, 2);
    expect(
      nextFreeAddresses(
        layout,
        [
          { row: 5, col: 5 },
          { row: 1, col: 1, index: 2 },
        ],
        5,
      ).map(slotKey),
    ).toEqual(["1:1:1", "1:2:1"]);
  });
});

describe("spots for new bottles, the first on a spot asked for", () => {
  const layout = rack(2, 2, 2);

  it("puts the first where asked and the rest on the next free ones", () => {
    expect(
      addressesFor(layout, [{ row: 1, col: 1 }], 3, { row: 2, col: 1, index: 2 })!.map(slotKey),
    ).toEqual(["2:1:2", "1:1:2", "1:2:1"]);
    // a spot asked for without an index is its front
    expect(addressesFor(layout, [], 1, { row: 2, col: 2 })).toEqual([{ row: 2, col: 2, index: 1 }]);
    // never two bottles on the asked-for spot, and only what fits
    expect(addressesFor(layout, [], 99, { row: 1, col: 1 })).toHaveLength(8);
    expect(addressesFor(layout, [], 0, { row: 1, col: 1 })).toEqual([]);
  });

  it("gives null for a spot that is taken or is not one: never another spot instead", () => {
    expect(addressesFor(layout, [{ row: 1, col: 1 }], 1, { row: 1, col: 1 })).toBeNull();
    expect(
      addressesFor(layout, [{ row: 1, col: 1, index: 2 }], 1, { row: 1, col: 1, index: 2 }),
    ).toBeNull();
    expect(addressesFor(layout, [], 1, { row: 3, col: 1 })).toBeNull();
    expect(addressesFor(layout, [], 1, { row: 1, col: 1, index: 3 })).toBeNull();
    expect(addressesFor(layout, [], 1, { row: 0, col: 1 })).toBeNull();
    // the front being taken does not make the back taken
    expect(addressesFor(layout, [{ row: 1, col: 1 }], 1, { row: 1, col: 1, index: 2 })).toEqual([
      { row: 1, col: 1, index: 2 },
    ]);
  });

  it("without a spot is exactly the next free spots", () => {
    const taken = [{ row: 1, col: 2 }];
    expect(addressesFor(layout, taken, 4)).toEqual(nextFreeAddresses(layout, taken, 4));
    expect(addressesFor(layout, taken, 4, null)).toEqual(nextFreeAddresses(layout, taken, 4));
  });
});

describe("a layout is plain data", () => {
  it("survives being written out and read back", () => {
    for (const layout of [rack(3, 4, 2), bins(2, 2, 9), uneven]) {
      const copy = JSON.parse(JSON.stringify(layout)) as LogicalLayout;
      expect(copy).toEqual(layout);
      expect(enumerateSlots(copy)).toEqual(enumerateSlots(layout));
      expect(nextFreeAddresses(copy, [{ row: 1, col: 1 }], 3)).toEqual(
        nextFreeAddresses(layout, [{ row: 1, col: 1 }], 3),
      );
    }
  });
});
