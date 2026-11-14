import { describe, expect, it } from "vitest";
import { CreateStorageSchema, STORAGE_KINDS, UpdateStorageSchema } from "./cellar";
import { nextFreeSlots, slotsFor, type Slot } from "./placement";
import { fromLegacySlot, legacyGridLayout, resolveStorage, toLegacySlot } from "./storage-compat";
import { StorageConfigSchema, StorageStructureSchema, defaultAppearance } from "./storage-config";
import {
  addressesFor,
  enumerateSlots,
  nextFreeAddresses,
  occupancyOf,
  slotKey,
} from "./storage-layout";
import {
  DEFAULT_TEMPLATE_FOR_KIND,
  STORAGE_TEMPLATE_IDS,
  STORAGE_TEMPLATES,
} from "./storage-templates";

/** A seeded random (mulberry32): the same cases on every run. */
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

const legacy = (slots: ReturnType<typeof nextFreeAddresses>) => slots.map(toLegacySlot);

describe("a two-coordinate spot is index 1", () => {
  it("goes there and comes back", () => {
    expect(fromLegacySlot({ row: 2, col: 3 })).toEqual({ row: 2, col: 3, index: 1 });
    expect(toLegacySlot({ row: 2, col: 3, index: 1 })).toEqual({ row: 2, col: 3 });
    expect(toLegacySlot({ row: 2, col: 3 })).toEqual({ row: 2, col: 3 });
    expect(slotKey(fromLegacySlot({ row: 2, col: 3 }))).toBe(slotKey({ row: 2, col: 3 }));
  });

  it("a bottle behind another has no two-coordinate form: it is never passed off as the front one", () => {
    expect(toLegacySlot({ row: 2, col: 3, index: 2 })).toBeNull();
  });
});

describe("the next free spots of an existing place are what they always were", () => {
  it("every grid up to 3 x 3, every possible occupancy, every count", () => {
    let cases = 0;
    for (let rows = 1; rows <= 3; rows++)
      for (let cols = 1; cols <= 3; cols++) {
        const grid = { rows, cols };
        const layout = legacyGridLayout(grid);
        const all = nextFreeSlots(grid, [], rows * cols);
        for (let mask = 0; mask < 1 << all.length; mask++) {
          const taken = all.filter((_, i) => mask & (1 << i));
          for (let count = -1; count <= all.length + 1; count++) {
            expect(legacy(nextFreeAddresses(layout, taken, count))).toEqual(
              nextFreeSlots(grid, taken, count),
            );
            cases++;
          }
        }
      }
    expect(cases).toBe(7552);
  });

  it("2000 random grids up to 30 x 30, with spots outside the grid and spots named twice among the taken", () => {
    const rnd = seeded(4);
    for (let run = 0; run < 2000; run++) {
      const grid = { rows: int(rnd, 1, 30), cols: int(rnd, 1, 30) };
      const taken: Slot[] = Array.from({ length: int(rnd, 0, grid.rows * grid.cols) }, () => ({
        row: int(rnd, 1, grid.rows + 1),
        col: int(rnd, 1, grid.cols + 1),
      }));
      const count = int(rnd, 0, 40);
      expect(legacy(nextFreeAddresses(legacyGridLayout(grid), taken, count))).toEqual(
        nextFreeSlots(grid, taken, count),
      );
    }
  });

  it("and so is a spot asked for: taken, outside, or the first of several", () => {
    const rnd = seeded(5);
    let refused = 0;
    for (let run = 0; run < 3000; run++) {
      const grid = { rows: int(rnd, 1, 8), cols: int(rnd, 1, 8) };
      const taken: Slot[] = Array.from({ length: int(rnd, 0, grid.rows * grid.cols) }, () => ({
        row: int(rnd, 1, grid.rows),
        col: int(rnd, 1, grid.cols),
      }));
      const first = { row: int(rnd, 0, grid.rows + 1), col: int(rnd, 0, grid.cols + 1) };
      const count = int(rnd, 0, 12);
      const was = slotsFor(grid, taken, count, first);
      const now = addressesFor(legacyGridLayout(grid), taken, count, first);
      expect(now === null ? null : legacy(now)).toEqual(was);
      if (was === null) refused++;
    }
    // both outcomes were really tested
    expect(refused).toBeGreaterThan(300);
    expect(refused).toBeLessThan(2700);
  });

  it("lists a grid's spots in the order the racks have always been filled", () => {
    for (const [rows, cols] of [
      [1, 1],
      [5, 4],
      [5, 8],
      [30, 30],
    ] as const) {
      const layout = legacyGridLayout({ rows, cols });
      expect(legacy(enumerateSlots(layout))).toEqual(
        nextFreeSlots({ rows, cols }, [], rows * cols),
      );
      expect(layout.capacity).toBe(rows * cols);
    }
  });
});

describe("a place from before templates, read in the new terms", () => {
  it("every kind and every size the database allows: the same grid, one bottle per cell, nothing replaced", () => {
    for (const kind of STORAGE_KINDS)
      for (let rows = 1; rows <= 30; rows++)
        for (let cols = 1; cols <= 30; cols++) {
          const r = resolveStorage({ kind, rows, cols });
          expect(r.legacy).toBe(true);
          expect(r.arrangementKnown).toBe(true);
          expect(r.fallbacks).toEqual([]);
          expect(r.template.id).toBe(DEFAULT_TEMPLATE_FOR_KIND[kind]);
          expect(r.template.kind).toBe(kind);
          expect(r.structure).toEqual({
            template: r.template.id,
            rows,
            cols,
            cellCapacity: 1,
            zones: [],
          });
          // what the storage view has always reported as its capacity
          expect(r.layout.capacity).toBe(rows * cols);
          expect(r.layout.cells).toHaveLength(rows * cols);
          expect(r.layout).toMatchObject({ rows, cols });
          // and it is a structure the strict write rules accept: editing an old place never fails on its size
          expect(StorageStructureSchema.safeParse(r.structure).success).toBe(true);
        }
  });

  it("has the same spots, in the same order, as the old grid", () => {
    for (const kind of STORAGE_KINDS) {
      const { layout } = resolveStorage({ kind, rows: 4, cols: 6 });
      expect(layout).toEqual({
        ...legacyGridLayout({ rows: 4, cols: 6 }),
        family: layout.family,
        semantics: layout.semantics,
      });
      expect(legacy(enumerateSlots(layout))).toEqual(nextFreeSlots({ rows: 4, cols: 6 }, [], 24));
    }
  });

  it("has its template's default look, and a whole configuration that is valid", () => {
    for (const kind of STORAGE_KINDS) {
      const r = resolveStorage({ kind, rows: 5, cols: 4 });
      expect(r.appearance).toEqual(defaultAppearance(r.template.id));
      expect(
        StorageConfigSchema.safeParse({ structure: r.structure, appearance: r.appearance }).success,
      ).toBe(true);
    }
  });

  it("an existing wall rack stays what it is: pegs, one position each, known, in the old order", () => {
    for (const [rows, cols] of [
      [6, 6],
      [1, 1],
      [30, 30],
    ] as const) {
      const r = resolveStorage({ kind: "wall", rows, cols });
      expect(r).toMatchObject({ legacy: true, arrangementKnown: true, fallbacks: [] });
      expect(r.template.id).toBe("wall_pegs");
      expect(r.layout).toMatchObject({
        family: "wall",
        semantics: "single",
        capacity: rows * cols,
      });
      expect(r.layout.cells.every((c) => c.capacity === 1)).toBe(true);
      expect(legacy(enumerateSlots(r.layout))).toEqual(
        nextFreeSlots({ rows, cols }, [], rows * cols),
      );
    }
  });

  it("is the same whether the new fields are absent or null", () => {
    const bare = resolveStorage({ kind: "rack", rows: 5, cols: 8 });
    expect(
      resolveStorage({
        kind: "rack",
        rows: 5,
        cols: 8,
        template: null,
        cellCapacity: null,
        zones: null,
        appearance: null,
      }),
    ).toEqual(bare);
    expect(
      resolveStorage({
        kind: "rack",
        rows: 5,
        cols: 8,
        template: undefined,
        cellCapacity: undefined,
      }),
    ).toEqual(bare);
  });

  it("is read the same way every time", () => {
    const stored = { kind: "fridge", rows: 7, cols: 5 } as const;
    expect(resolveStorage(stored)).toEqual(resolveStorage({ ...stored }));
    expect(JSON.stringify(resolveStorage(stored))).toBe(JSON.stringify(resolveStorage(stored)));
  });
});

describe("a place with a template, read back", () => {
  const dual = {
    kind: "fridge",
    rows: 8,
    cols: 5,
    template: "cooler_dual",
    cellCapacity: 2,
    zones: [
      { fromRow: 1, toRow: 3, purpose: "serving", targetTempC: 7.5 },
      { fromRow: 4, toRow: 8, purpose: "storage", targetTempC: 12 },
    ],
    appearance: { v: 1, material: "lacquer", color: "black", lighting: "cool", door: "glass" },
  } as const;

  it("uses everything stored as it is", () => {
    const r = resolveStorage(dual);
    expect(r.legacy).toBe(false);
    expect(r.fallbacks).toEqual([]);
    expect(r.template.id).toBe("cooler_dual");
    expect(r.structure).toEqual({
      template: "cooler_dual",
      rows: 8,
      cols: 5,
      cellCapacity: 2,
      zones: dual.zones,
    });
    expect(r.appearance).toEqual(dual.appearance);
    expect(r.layout).toMatchObject({ family: "grid", semantics: "depth", capacity: 80 });
    expect(
      StorageConfigSchema.safeParse({ structure: r.structure, appearance: r.appearance }).success,
    ).toBe(true);
  });

  it("a template this app does not know: the kind's own template, and the stored size keeps every spot", () => {
    const taken = [
      { row: 8, col: 5, index: 2 },
      { row: 1, col: 1 },
    ];
    const r = resolveStorage({
      ...dual,
      template: "cooler_triple_2031",
      zones: undefined,
      appearance: undefined,
    });
    expect(r.fallbacks).toEqual(["unknown_template"]);
    expect(r.legacy).toBe(false);
    expect(r.arrangementKnown).toBe(false);
    // two bottles per cell in furniture this app does not know: the index is a counter, not a depth
    expect(r.layout.semantics).toBe("ordinal");
    expect(r.template.id).toBe("cooler_single");
    expect(r.layout.capacity).toBe(80);
    expect(occupancyOf(r.layout, taken).stranded).toEqual([]);
  });

  it("zones that do not add up are left out, not half-used", () => {
    const broken = [
      [{ fromRow: 1, toRow: 3, purpose: "serving", targetTempC: 7 }],
      [{ fromRow: 1, toRow: 8, purpose: "serving", targetTempC: 99 }],
      [{ fromRow: 1, toRow: 8, purpose: "serving", targetTempC: 7, measuredTempC: 9 }],
      "two",
      [1, 2],
      {},
    ];
    for (const zones of broken) {
      const r = resolveStorage({ ...dual, zones });
      expect(r.structure.zones).toEqual([]);
      expect(r.fallbacks).toEqual(["zones"]);
      expect(r.layout.capacity).toBe(80);
    }
    // zones stored on a place that has none
    expect(
      resolveStorage({
        kind: "rack",
        rows: 5,
        cols: 8,
        template: "rack_classic",
        zones: dual.zones.slice(0, 1),
      }).fallbacks,
    ).toEqual(["zones"]);
  });

  it("a look from another version: the template's default, and it says so", () => {
    const r = resolveStorage({ ...dual, appearance: { ...dual.appearance, v: 2, sheen: 0.4 } });
    expect(r.appearance).toEqual(defaultAppearance("cooler_dual"));
    expect(r.fallbacks).toEqual(["appearance"]);
    expect(r.structure.zones).toEqual(dual.zones);
  });

  it("never reads a bottle's spot away: the stored size wins over the template's limits", () => {
    // more shelves than an undercounter cooler is sold with, two deep as it may be: still that cooler, only larger
    const tall = resolveStorage({
      kind: "fridge",
      rows: 30,
      cols: 30,
      template: "cooler_undercounter",
      cellCapacity: 2,
    });
    expect(tall.fallbacks).toEqual([]);
    expect(tall.arrangementKnown).toBe(true);
    expect(tall.layout).toMatchObject({ semantics: "depth", capacity: 1800 });
    expect(occupancyOf(tall.layout, [{ row: 30, col: 30, index: 2 }]).stranded).toEqual([]);
    // (it could not be WRITTEN like this)
    expect(StorageStructureSchema.safeParse(tall.structure).success).toBe(false);

    // three deep where it offers two: every spot is kept, but it is no longer read as that cooler
    const deep = resolveStorage({
      kind: "fridge",
      rows: 30,
      cols: 30,
      template: "cooler_undercounter",
      cellCapacity: 3,
    });
    expect(deep.fallbacks).toEqual(["capacity_not_in_template"]);
    expect(deep.arrangementKnown).toBe(false);
    expect(deep.layout).toMatchObject({ semantics: "ordinal", capacity: 2700 });
    expect(occupancyOf(deep.layout, [{ row: 30, col: 30, index: 3 }]).stranded).toEqual([]);
  });

  it("a peg stored with more than one bottle: the spots exist, with no claim about where on the peg", () => {
    const r = resolveStorage({
      kind: "wall",
      rows: 2,
      cols: 2,
      template: "wall_pegs",
      cellCapacity: 2,
    });
    expect(r.template.semantics).toBe("single");
    expect(r.layout.semantics).toBe("ordinal");
    expect(r.layout.capacity).toBe(8);
    expect(occupancyOf(r.layout, [{ row: 1, col: 1, index: 2 }]).stranded).toEqual([]);
    // two bottles on one peg is not wall pegs as the app knows them: it must not be shown as if it were
    expect(r.arrangementKnown).toBe(false);
    expect(r.fallbacks).toEqual(["capacity_not_in_template"]);
    expect(r.legacy).toBe(false);
  });

  it("a size or capacity that is not a number from the database is made safe, and it says so", () => {
    const r = resolveStorage({ kind: "rack", rows: 99, cols: 2.7, cellCapacity: 0 });
    expect(r.structure).toMatchObject({ rows: 30, cols: 2, cellCapacity: 1 });
    expect(r.fallbacks).toEqual(["size", "cell_capacity"]);
    const nan = resolveStorage({ kind: "rack", rows: Number.NaN, cols: 3 });
    expect(nan.structure).toMatchObject({ rows: 1, cols: 3 });
    expect(nan.fallbacks).toEqual(["size"]);
    expect(
      resolveStorage({ kind: "rack", rows: 2, cols: 2, cellCapacity: 400 }).structure.cellCapacity,
    ).toBe(16);
  });

  it("never throws, whatever is stored", () => {
    const rnd = seeded(9);
    const junk: unknown[] = [
      undefined,
      null,
      0,
      -1,
      1.5,
      31,
      1e9,
      Number.NaN,
      "",
      "rack_classic",
      "x".repeat(500),
      [],
      {},
      [[]],
      { v: 1 },
      true,
    ];
    const pick = () => junk[int(rnd, 0, junk.length - 1)];
    for (let run = 0; run < 3000; run++) {
      const stored = {
        kind: pick(),
        rows: pick(),
        cols: pick(),
        template: pick(),
        cellCapacity: pick(),
        zones: pick(),
        appearance: pick(),
      } as unknown as Parameters<typeof resolveStorage>[0];
      const r = resolveStorage(stored);
      expect(r.structure.rows).toBeGreaterThanOrEqual(1);
      expect(r.structure.cols).toBeGreaterThanOrEqual(1);
      expect(r.layout.capacity).toBe(
        r.structure.rows * r.structure.cols * r.structure.cellCapacity,
      );
      expect(r.layout.capacity).toBeGreaterThanOrEqual(1);
      expect(r.appearance.v).toBe(1);
      // furniture the app is not sure of never gets a depth
      if (!r.arrangementKnown && r.structure.cellCapacity > 1)
        expect(r.layout.semantics).toBe("ordinal");
      expect(
        r.fallbacks.includes("unknown_template") && r.fallbacks.includes("template_kind_mismatch"),
      ).toBe(false);
    }
  });
});

describe("a template that does not belong to the place's kind", () => {
  /** Every (kind, template) pair where the template is of another kind: 14 templates x the 5 other kinds. */
  const mismatches = STORAGE_KINDS.flatMap((kind) =>
    STORAGE_TEMPLATE_IDS.filter((id) => STORAGE_TEMPLATES[id].kind !== kind).map(
      (template) => ({ kind, template }) as const,
    ),
  );

  it("is every such pair, and each is reported as a mismatch, not as an unknown template", () => {
    expect(mismatches).toHaveLength(14 * 5);
    for (const { kind, template } of mismatches)
      for (const cellCapacity of [1, 2, 9]) {
        const r = resolveStorage({ kind, rows: 4, cols: 3, template, cellCapacity });
        expect(r.fallbacks).toEqual(["template_kind_mismatch"]);
        expect(r.arrangementKnown).toBe(false);
        expect(r.legacy).toBe(false);
        // the kind's own template stands in; the stored one is not used for anything
        expect(r.template.id).toBe(DEFAULT_TEMPLATE_FOR_KIND[kind]);
        expect(r.structure.template).toBe(DEFAULT_TEMPLATE_FOR_KIND[kind]);
        expect(r.template.kind).toBe(kind);
      }
  });

  it("keeps every stored spot: the same cells, the same capacity, the same identities in the same order", () => {
    for (const { kind, template } of mismatches)
      for (const cellCapacity of [1, 2, 9]) {
        const stored = { kind, rows: 4, cols: 3, cellCapacity };
        const r = resolveStorage({ ...stored, template });
        expect(r.layout.capacity).toBe(4 * 3 * cellCapacity);
        expect(r.layout.cells).toHaveLength(12);
        // exactly the spots the same place has without a template, and with its kind's own
        expect(enumerateSlots(r.layout)).toEqual(enumerateSlots(resolveStorage(stored).layout));
        // a bottle anywhere in it, the deepest spot of the last cell included, is still on a valid spot
        const taken = [
          { row: 1, col: 1 },
          { row: 4, col: 3, index: cellCapacity },
          { row: 2, col: 2, index: Math.ceil(cellCapacity / 2) },
        ];
        expect(occupancyOf(r.layout, taken).stranded).toEqual([]);
        expect(occupancyOf(r.layout, taken).used).toBe(new Set(taken.map(slotKey)).size);
      }
  });

  it("never reads the index as a position in some other furniture", () => {
    for (const { kind, template } of mismatches) {
      const deep = resolveStorage({ kind, rows: 4, cols: 3, template, cellCapacity: 3 });
      // neither the stored template's meaning nor the stand-in's: a counter, which claims nothing
      expect(deep.layout.semantics).toBe("ordinal");
      // one bottle per cell has no index to give a meaning to
      const flat = resolveStorage({ kind, rows: 4, cols: 3, template, cellCapacity: 1 });
      expect(flat.layout.cells.every((c) => c.capacity === 1)).toBe(true);
    }
    // the case that matters most: a rack stored with a bin's template must not turn a bin's counters into depths,
    // and a place of bins stored with a rack's template must not keep claiming depths
    const rackWithBins = resolveStorage({
      kind: "fridge",
      rows: 2,
      cols: 2,
      template: "diamond_bins",
      cellCapacity: 8,
    });
    expect(rackWithBins.template.semantics).toBe("depth");
    expect(rackWithBins.layout.semantics).toBe("ordinal");
    const binsWithRack = resolveStorage({
      kind: "other",
      rows: 5,
      cols: 8,
      template: "rack_double_depth",
      cellCapacity: 2,
    });
    expect(binsWithRack.layout.semantics).toBe("ordinal");
  });

  it("is not triggered by a template of the place's own kind, whatever its cells hold", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[id];
      for (const cellCapacity of [1, t.cellCapacity.max]) {
        const r = resolveStorage({
          kind: t.kind,
          rows: t.rows.min,
          cols: t.cols.min,
          template: id,
          cellCapacity,
        });
        expect(r.fallbacks).toEqual([]);
        expect(r.arrangementKnown).toBe(true);
        expect(r.template).toBe(t);
        // here the index means what the template says it means
        expect(r.layout.semantics).toBe(t.semantics);
        expect(r.layout.family).toBe(t.family);
      }
    }
    // two deep in a rack is a depth; several in a bin is a counter
    expect(
      resolveStorage({
        kind: "rack",
        rows: 5,
        cols: 8,
        template: "rack_double_depth",
        cellCapacity: 2,
      }).layout.semantics,
    ).toBe("depth");
    expect(
      resolveStorage({ kind: "rack", rows: 2, cols: 3, template: "diamond_bins", cellCapacity: 8 })
        .layout.semantics,
    ).toBe("ordinal");
  });

  it("an unknown template is told apart from a mismatched one, and is treated as carefully", () => {
    for (const kind of STORAGE_KINDS)
      for (const template of [
        "hex_rack_2031",
        "",
        "RACK_CLASSIC",
        "__proto__",
        7,
        {},
      ] as unknown[]) {
        for (const cellCapacity of [1, 4]) {
          const stored = { kind, rows: 3, cols: 5, cellCapacity };
          const r = resolveStorage({ ...stored, template: template as string });
          expect(r.fallbacks).toEqual(["unknown_template"]);
          expect(r.arrangementKnown).toBe(false);
          expect(r.template.id).toBe(DEFAULT_TEMPLATE_FOR_KIND[kind]);
          expect(enumerateSlots(r.layout)).toEqual(enumerateSlots(resolveStorage(stored).layout));
          if (cellCapacity > 1) expect(r.layout.semantics).toBe("ordinal");
        }
      }
  });

  it("a kind this app does not know, with a template it does: the template is what there is to go on", () => {
    const r = resolveStorage({
      kind: "cave" as never,
      rows: 2,
      cols: 3,
      template: "diamond_bins",
      cellCapacity: 8,
    });
    expect(r.fallbacks).toEqual(["unknown_kind"]);
    expect(r.arrangementKnown).toBe(true);
    expect(r.template.id).toBe("diamond_bins");
    expect(r.layout).toMatchObject({ family: "bins", semantics: "ordinal", capacity: 48 });
    // with neither known, nothing is claimed
    const neither = resolveStorage({
      kind: "cave" as never,
      rows: 2,
      cols: 3,
      template: "stalactite",
      cellCapacity: 2,
    });
    expect(neither.fallbacks).toEqual(["unknown_kind", "unknown_template"]);
    expect(neither.arrangementKnown).toBe(false);
    expect(neither.layout).toMatchObject({ semantics: "ordinal", capacity: 12 });
  });

  it("leaves a place from before templates exactly as it was", () => {
    for (const kind of STORAGE_KINDS) {
      const r = resolveStorage({ kind, rows: 5, cols: 4 });
      expect(r).toMatchObject({ legacy: true, arrangementKnown: true, fallbacks: [] });
      expect(r.layout.semantics).toBe(STORAGE_TEMPLATES[DEFAULT_TEMPLATE_FOR_KIND[kind]].semantics);
      expect(legacy(enumerateSlots(r.layout))).toEqual(nextFreeSlots({ rows: 5, cols: 4 }, [], 20));
    }
  });
});

describe("more bottles per cell than the template describes", () => {
  const UNSURE = [
    "unknown_template",
    "template_kind_mismatch",
    "capacity_not_in_template",
  ] as const;

  it("wall pegs with several bottles per peg: every spot and every bottle kept, never shown as known", () => {
    for (const cellCapacity of [2, 3, 16]) {
      const stored = {
        kind: "wall",
        rows: 6,
        cols: 6,
        template: "wall_pegs",
        cellCapacity,
      } as const;
      const r = resolveStorage(stored);
      expect(r.arrangementKnown).toBe(false);
      expect(r.fallbacks).toEqual(["capacity_not_in_template"]);
      expect(r.legacy).toBe(false);
      expect(r.layout.semantics).toBe("ordinal");
      // the spots: all of them, the same as any place of that size, in the same order
      expect(r.layout.capacity).toBe(36 * cellCapacity);
      expect(enumerateSlots(r.layout).map(slotKey)).toEqual(
        enumerateSlots(
          resolveStorage({
            kind: "other",
            rows: 6,
            cols: 6,
            template: "rack_generic",
            cellCapacity,
          }).layout,
        ).map(slotKey),
      );
      // the occupancy: a full peg, a half-full one, the last index of the last peg
      const taken = [
        ...Array.from({ length: cellCapacity }, (_, i) => ({ row: 1, col: 1, index: i + 1 })),
        { row: 3, col: 4, index: 2 },
        { row: 6, col: 6, index: cellCapacity },
      ];
      const o = occupancyOf(r.layout, taken);
      expect(o).toMatchObject({ used: cellCapacity + 2, stranded: [], doubled: [] });
      expect(o.free).toBe(36 * cellCapacity - cellCapacity - 2);
      // and the next free spot is found as in any other place
      expect(nextFreeAddresses(r.layout, taken, 1)).toEqual([{ row: 1, col: 2, index: 1 }]);
    }
    // one bottle per peg is wall pegs, known
    const pegs = resolveStorage({
      kind: "wall",
      rows: 6,
      cols: 6,
      template: "wall_pegs",
      cellCapacity: 1,
    });
    expect(pegs).toMatchObject({ arrangementKnown: true, fallbacks: [], legacy: false });
    expect(pegs.layout.semantics).toBe("single");
  });

  it("every template with its own kind, at every capacity: known exactly up to what the template describes", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[id];
      for (let cellCapacity = 1; cellCapacity <= 16; cellCapacity++) {
        const r = resolveStorage({ kind: t.kind, rows: 3, cols: 4, template: id, cellCapacity });
        const described = cellCapacity <= t.cellCapacity.max;
        expect(r.arrangementKnown).toBe(described);
        expect(r.fallbacks).toEqual(described ? [] : ["capacity_not_in_template"]);
        expect(r.layout.semantics).toBe(described ? t.semantics : "ordinal");
        // whichever it is, no spot is lost
        expect(r.layout.capacity).toBe(12 * cellCapacity);
        expect(r.structure.cellCapacity).toBe(cellCapacity);
      }
    }
  });

  it("a place with no template and more than one bottle per cell is not a place from before templates", () => {
    for (const kind of STORAGE_KINDS) {
      const r = resolveStorage({ kind, rows: 4, cols: 5, cellCapacity: 2 });
      expect(r.legacy).toBe(false);
      expect(r.arrangementKnown).toBe(false);
      expect(r.fallbacks).toEqual(["capacity_not_in_template"]);
      expect(r.layout).toMatchObject({ semantics: "ordinal", capacity: 40 });
      expect(occupancyOf(r.layout, [{ row: 4, col: 5, index: 2 }]).stranded).toEqual([]);
    }
  });

  it("what `arrangementKnown` promises holds for every kind, template and capacity", () => {
    let known = 0;
    let unsure = 0;
    for (const kind of STORAGE_KINDS)
      for (const template of [null, "hex_rack_2031", ...STORAGE_TEMPLATE_IDS])
        for (let cellCapacity = 1; cellCapacity <= 16; cellCapacity++) {
          const r = resolveStorage({ kind, rows: 2, cols: 3, template, cellCapacity });
          const reasons = r.fallbacks.filter((f) => (UNSURE as readonly string[]).includes(f));
          // known, or exactly one reason why not
          expect(reasons).toHaveLength(r.arrangementKnown ? 0 : 1);
          if (r.arrangementKnown) {
            known++;
            // the layout is the template's own, and nothing in it exceeds what the template describes
            expect(r.layout.semantics).toBe(r.template.semantics);
            expect(r.layout.family).toBe(r.template.family);
            expect(r.template.kind).toBe(kind);
            expect(cellCapacity).toBeLessThanOrEqual(r.template.cellCapacity.max);
            if (template !== null) expect(r.template.id).toBe(template);
          } else {
            unsure++;
            // nothing is claimed about where in a cell a bottle lies
            if (cellCapacity > 1) expect(r.layout.semantics).toBe("ordinal");
          }
          // a layout that says "one position per cell" has one position per cell
          if (r.layout.semantics === "single")
            expect(r.layout.cells.every((c) => c.capacity === 1)).toBe(true);
          // a place from before templates is exactly: no template, one bottle per cell, known
          expect(r.legacy).toBe(template === null && cellCapacity === 1);
          if (r.legacy) expect(r.arrangementKnown).toBe(true);
          // and always: every stored spot, nothing more
          expect(r.layout.capacity).toBe(6 * cellCapacity);
          expect(enumerateSlots(r.layout)).toHaveLength(6 * cellCapacity);
        }
    expect(known + unsure).toBe(6 * 16 * 16);
    expect(known).toBeGreaterThan(30);
    expect(unsure).toBeGreaterThan(1000);
  });
});

describe("the meaning of the index as the database stores it (cellar_locations.slot_semantics)", () => {
  const SEMANTICS = ["depth", "ordinal", "single"] as const;

  it("a place without a template: the stored value is never read, whatever it is", () => {
    for (const kind of STORAGE_KINDS) {
      const bare = resolveStorage({ kind, rows: 6, cols: 6 });
      for (const semantics of [null, "depth", "ordinal", "single", "sideways", ""])
        expect(resolveStorage({ kind, rows: 6, cols: 6, template: null, semantics })).toEqual(bare);
      expect(bare).toMatchObject({ legacy: true, arrangementKnown: true, fallbacks: [] });
    }
  });

  it("an existing wall rack is pegs with one position each, also on a database that says 'depth' about it", () => {
    // what a column default of 'depth' would have put on every existing row: it must change nothing
    const r = resolveStorage({
      kind: "wall",
      rows: 6,
      cols: 6,
      template: null,
      cellCapacity: 1,
      semantics: "depth",
    });
    expect(r).toMatchObject({ legacy: true, arrangementKnown: true, fallbacks: [] });
    expect(r.template.id).toBe("wall_pegs");
    expect(r.layout).toMatchObject({ family: "wall", semantics: "single", capacity: 36 });
    expect(legacy(enumerateSlots(r.layout))).toEqual(nextFreeSlots({ rows: 6, cols: 6 }, [], 36));
  });

  it("a template stored with its own semantics is that template's arrangement", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[id];
      for (const cellCapacity of [1, t.cellCapacity.max]) {
        const r = resolveStorage({
          kind: t.kind,
          rows: 3,
          cols: 3,
          template: id,
          cellCapacity,
          semantics: t.semantics,
        });
        expect(r).toMatchObject({ arrangementKnown: true, fallbacks: [], legacy: false });
        expect(r.layout.semantics).toBe(t.semantics);
      }
    }
  });

  it("a template stored with ANOTHER semantics: neither is believed, every spot is kept", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[id];
      for (const semantics of [...SEMANTICS.filter((s) => s !== t.semantics), null, "sideways"])
        for (const cellCapacity of [1, t.cellCapacity.max]) {
          const stored = { kind: t.kind, rows: 3, cols: 4, template: id, cellCapacity };
          const r = resolveStorage({ ...stored, semantics });
          expect(r.fallbacks).toEqual(["semantics_mismatch"]);
          expect(r.arrangementKnown).toBe(false);
          expect(r.legacy).toBe(false);
          // the same spots, in the same order, as when nothing was wrong
          expect(enumerateSlots(r.layout)).toEqual(enumerateSlots(resolveStorage(stored).layout));
          expect(r.layout.capacity).toBe(12 * cellCapacity);
          // with more than one bottle per cell the index is a bare counter: not the stored meaning, not the
          // template's, and above all never a depth that was not there
          if (cellCapacity > 1) expect(r.layout.semantics).toBe("ordinal");
        }
    }
  });

  it("bins stored as 'depth' are not read as depths, and a deep rack stored as 'ordinal' not as that rack", () => {
    const bins = resolveStorage({
      kind: "rack",
      rows: 2,
      cols: 3,
      template: "diamond_bins",
      cellCapacity: 8,
      semantics: "depth",
    });
    expect(bins.layout.semantics).toBe("ordinal");
    expect(bins.arrangementKnown).toBe(false);
    const rack = resolveStorage({
      kind: "rack",
      rows: 5,
      cols: 8,
      template: "rack_double_depth",
      cellCapacity: 2,
      semantics: "ordinal",
    });
    expect(rack.layout.semantics).toBe("ordinal");
    expect(rack.arrangementKnown).toBe(false);
    expect(occupancyOf(rack.layout, [{ row: 5, col: 8, index: 2 }]).stranded).toEqual([]);
  });

  it("only one reason is given, the first that applies", () => {
    // an unknown template is reported as that, not also as a mismatch of semantics it cannot have
    expect(
      resolveStorage({ kind: "rack", rows: 2, cols: 2, template: "hex_2031", semantics: "depth" })
        .fallbacks,
    ).toEqual(["unknown_template"]);
    expect(
      resolveStorage({
        kind: "wall",
        rows: 2,
        cols: 2,
        template: "rack_classic",
        semantics: "depth",
      }).fallbacks,
    ).toEqual(["template_kind_mismatch"]);
    expect(
      resolveStorage({
        kind: "wall",
        rows: 2,
        cols: 2,
        template: "wall_pegs",
        cellCapacity: 2,
        semantics: "depth",
      }).fallbacks,
    ).toEqual(["capacity_not_in_template"]);
  });

  it("a caller that does not read the column at all gets what it got before it existed", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[id];
      const stored = { kind: t.kind, rows: 3, cols: 3, template: id, cellCapacity: 1 };
      expect(resolveStorage(stored)).toEqual(resolveStorage({ ...stored, semantics: t.semantics }));
      expect(resolveStorage({ ...stored, semantics: undefined })).toEqual(resolveStorage(stored));
    }
  });
});

describe("the contracts existing clients use are untouched", () => {
  it("creating and changing a place takes what it always took, and gives what it always gave", () => {
    expect(CreateStorageSchema.parse({ label: " Wine fridge ", rows: 5, cols: 4 })).toEqual({
      label: "Wine fridge",
      kind: "fridge",
      rows: 5,
      cols: 4,
    });
    expect(CreateStorageSchema.parse({ label: "Rack", kind: "rack", rows: 30, cols: 30 })).toEqual({
      label: "Rack",
      kind: "rack",
      rows: 30,
      cols: 30,
    });
    expect(UpdateStorageSchema.parse({ rows: 6 })).toEqual({ rows: 6 });
    expect(
      CreateStorageSchema.safeParse({ label: "Rack", kind: "rack", rows: 31, cols: 1 }).success,
    ).toBe(false);
    expect(STORAGE_KINDS).toEqual(["fridge", "rack", "cabinet", "shelving", "wall", "other"]);
  });
});
