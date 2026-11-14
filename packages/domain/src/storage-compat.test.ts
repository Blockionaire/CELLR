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
import { DEFAULT_TEMPLATE_FOR_KIND } from "./storage-templates";

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
    // more shelves than an undercounter cooler is sold with, and three deep where it offers two
    const r = resolveStorage({
      kind: "fridge",
      rows: 30,
      cols: 30,
      template: "cooler_undercounter",
      cellCapacity: 3,
    });
    expect(r.fallbacks).toEqual([]);
    expect(r.layout.capacity).toBe(2700);
    expect(occupancyOf(r.layout, [{ row: 30, col: 30, index: 3 }]).stranded).toEqual([]);
    // (it could not be WRITTEN like this)
    expect(StorageStructureSchema.safeParse(r.structure).success).toBe(false);
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
