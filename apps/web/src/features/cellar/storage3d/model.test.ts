import { describe, expect, it } from "vitest";
import {
  STORAGE_KINDS,
  STORAGE_PALETTES,
  STORAGE_TEMPLATE_IDS,
  STORAGE_TEMPLATES,
  enumerateSlots,
  resolveStorage,
  slotKey,
  type StorageTemplateId,
} from "@cellr/domain";
import { FOV, slotPosition } from "../three/layout";
import { fixtureBottles, fixturePlace } from "./fixtures";
import {
  QUALITY,
  START_AZIMUTH,
  buildModel,
  frameFor,
  lowerQuality,
  placeBottles,
  qualityFor,
  rendererFor,
  type RenderModel,
} from "./model";
import { MATERIAL_ROLES, TONES, lookFor } from "./palette";
import { BOTTLE_L, BOTTLE_R, penetration, type Pose, poseBounds } from "./parts";

const FAMILY_OF: Record<string, "grid" | "bins" | "wall"> = {
  rack_classic: "grid",
  rack_double_depth: "grid",
  rack_metal: "grid",
  shelving_open: "grid",
  cabinet_closed: "grid",
  rack_generic: "grid",
  cooler_single: "grid",
  cooler_dual: "grid",
  cooler_undercounter: "grid",
  cube_modular: "bins",
  diamond_bins: "bins",
  crate_storage: "bins",
  wall_pegs: "wall",
  wall_rails: "wall",
};

/** Configurations of a template worth checking: out of the box, smallest, and as deep or full as it goes. */
function configs(id: StorageTemplateId) {
  const t = STORAGE_TEMPLATES[id];
  const fits = (rows: number, cols: number, cap: number) => rows * cols * cap <= t.maxCapacity;
  const list = [
    { rows: t.rows.default, cols: t.cols.default, cellCapacity: t.cellCapacity.default },
    { rows: t.rows.min, cols: t.cols.min, cellCapacity: t.cellCapacity.min },
    {
      rows: Math.min(t.rows.max, 4),
      cols: Math.min(t.cols.max, 3),
      cellCapacity: t.cellCapacity.max,
    },
    {
      rows: Math.min(t.rows.max, 3),
      cols: Math.min(t.cols.max, 2),
      cellCapacity: Math.ceil((t.cellCapacity.min + t.cellCapacity.max) / 2),
    },
  ];
  return list.filter((c) => fits(c.rows, c.cols, c.cellCapacity));
}
const modelOf = (id: StorageTemplateId, c = {}) => buildModel(fixturePlace({ template: id, ...c }));
const full = (m: RenderModel) => placeBottles(m, fixtureBottles(m.resolved.layout, "full"));

/** Two bottles in their poses: how far they reach into each other (0 or less: apart). */
function overlap(a: Pose, b: Pose): number {
  const along = a.lie === "z" ? 2 : 0;
  const across = a.lie === "z" ? [0, 1] : [1, 2];
  const axisGap = Math.abs(a.position[along]! - b.position[along]!) - BOTTLE_L;
  if (axisGap >= 0) return -axisGap;
  const d = Math.hypot(
    a.position[across[0]!]! - b.position[across[0]!]!,
    a.position[across[1]!]! - b.position[across[1]!]!,
  );
  return 2 * BOTTLE_R - d;
}

describe("every template of the catalogue has a renderer", () => {
  for (const id of STORAGE_TEMPLATE_IDS) {
    it(`${id}: drawn by its layout's own family, as its own furniture`, () => {
      const m = modelOf(id);
      expect(m.resolved.arrangementKnown).toBe(true);
      expect(m.renderer).toBe(FAMILY_OF[id]);
      expect(m.renderer).toBe(m.resolved.layout.family);
      expect(m.templateId).toBe(id);
      expect(m.parts.length).toBeGreaterThan(0);
      // where the index is a position, a spot has a pose; where it is a counter, a compartment has a pile
      const physical = m.resolved.layout.semantics !== "ordinal";
      expect(m.built.poseOf !== undefined).toBe(physical);
      expect(m.built.pileOf !== undefined).toBe(!physical);
    });
  }

  it("is fourteen templates over three families", () => {
    const families = new Set(STORAGE_TEMPLATE_IDS.map((id) => modelOf(id).renderer));
    expect(STORAGE_TEMPLATE_IDS).toHaveLength(14);
    expect([...families].sort()).toEqual(["bins", "grid", "wall"]);
    expect(Object.keys(FAMILY_OF).sort()).toEqual([...STORAGE_TEMPLATE_IDS].sort());
  });

  it("no two templates are the same furniture in another colour", () => {
    // the same look for all, so only the geometry can tell them apart
    const signature = (id: StorageTemplateId) => {
      const t = STORAGE_TEMPLATES[id];
      const m = buildModel(
        resolveStorage({
          kind: t.kind,
          rows: 3,
          cols: 3,
          template: id,
          cellCapacity: t.cellCapacity.default,
          semantics: t.semantics,
        }),
      );
      return JSON.stringify(
        m.parts
          .map((p) => [
            p.shape,
            p.rotZ ? 1 : 0,
            ...p.size.map((v) => v.toFixed(3)),
            ...p.pos.map((v) => v.toFixed(3)),
          ])
          .sort(),
      );
    };
    const all = STORAGE_TEMPLATE_IDS.map(signature);
    expect(new Set(all).size).toBe(14);
  });

  it("the three families lay a bottle down differently: neck to you in racks and bins, along the wall on a wall", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const m = modelOf(id);
      const lies = new Set(full(m).placed.map((b) => b.pose.lie));
      expect([...lies]).toEqual([m.renderer === "wall" ? "x" : "z"]);
    }
  });
});

describe("a place from before templates is not drawn by this renderer", () => {
  it("every kind and size: `legacy`, no furniture of ours, and the existing view's positions are what they were", () => {
    for (const kind of STORAGE_KINDS)
      for (const [rows, cols] of [
        [1, 1],
        [5, 4],
        [30, 30],
      ] as const) {
        const resolved = resolveStorage({ kind, rows, cols });
        expect(rendererFor(resolved)).toBe("legacy");
        const m = buildModel(resolved);
        expect(m.parts).toEqual([]);
        expect(m.templateId).toBeNull();
        expect(m.built.poseOf).toBeUndefined();
        // the existing scene keeps placing by its own function, untouched
        expect(slotPosition(1, 1, rows, cols)).toEqual([1 - (cols + 1) / 2, (rows + 1) / 2 - 1, 0]);
      }
  });
});

describe("no occupied spot disappears", () => {
  for (const id of STORAGE_TEMPLATE_IDS)
    it(`${id}: a full place shows one bottle for every spot, each with its own identity`, () => {
      for (const c of configs(id)) {
        const m = modelOf(id, c);
        const bottles = fixtureBottles(m.resolved.layout, "full");
        const { placed, stranded } = placeBottles(m, bottles);
        expect(bottles).toHaveLength(m.resolved.layout.capacity);
        expect(placed).toHaveLength(m.resolved.layout.capacity);
        expect(stranded).toEqual([]);
        expect(new Set(placed.map((b) => b.id)).size).toBe(placed.length);
        expect(new Set(placed.map((b) => slotKey(b.address))).size).toBe(placed.length);
        // every bottle keeps the spot it was stored on
        for (const b of placed) expect(b.id).toBe(`b-${slotKey(b.address)}`);
      }
    });

  it("a bottle on a spot that is not one of the place's is reported, never drawn somewhere else", () => {
    const m = modelOf("rack_double_depth", { rows: 2, cols: 2, cellCapacity: 2 });
    const b = (row: number, col: number, index: number) =>
      ({ id: `x${row}${col}${index}`, row, col, index, type: "red", shape: "bordeaux" }) as const;
    const { placed, stranded } = placeBottles(m, [
      b(1, 1, 1),
      b(1, 1, 3),
      b(3, 1, 1),
      b(1, 1, 1),
      b(0, 1, 1),
    ]);
    expect(placed.map((p) => p.id)).toEqual(["x111"]);
    expect(stranded).toHaveLength(4);
  });
});

describe("where the index is a depth, it is a place in space", () => {
  const deep: StorageTemplateId[] = [
    "rack_double_depth",
    "rack_metal",
    "shelving_open",
    "cabinet_closed",
    "rack_generic",
    "cooler_single",
    "cooler_dual",
    "cooler_undercounter",
    "wall_rails",
  ];

  for (const id of deep)
    it(`${id}: index 2 lies behind index 1, on the same shelf and position, and every spot is somewhere else`, () => {
      const t = STORAGE_TEMPLATES[id];
      const m = modelOf(id, {
        rows: Math.max(2, t.rows.min),
        cols: 2,
        cellCapacity: t.cellCapacity.max,
      });
      expect(m.resolved.layout.semantics).toBe("depth");
      const pose = m.built.poseOf!;
      for (const cell of m.resolved.layout.cells)
        for (let index = 2; index <= cell.capacity; index++) {
          const front = pose(cell.row, cell.col, index - 1).position;
          const behind = pose(cell.row, cell.col, index).position;
          expect(behind[0]).toBe(front[0]);
          expect(behind[1]).toBe(front[1]);
          // further from the viewer by at least a whole bottle (racks) or a whole bottle's width (rails)
          expect(front[2] - behind[2]).toBeGreaterThanOrEqual(
            m.renderer === "wall" ? 2 * BOTTLE_R : BOTTLE_L,
          );
        }
      const seen = new Set(
        enumerateSlots(m.resolved.layout).map((s) =>
          pose(s.row, s.col, s.index)
            .position.map((v) => v.toFixed(4))
            .join(","),
        ),
      );
      expect(seen.size).toBe(m.resolved.layout.capacity);
    });

  it("a spot's place does not depend on what else is in the rack", () => {
    const m = modelOf("rack_double_depth", { rows: 3, cols: 3, cellCapacity: 2 });
    const all = full(m).placed;
    const alone = placeBottles(m, [all.find((b) => slotKey(b.address) === "2:3:2")!]).placed[0]!;
    expect(alone.pose).toEqual(all.find((b) => b.id === alone.id)!.pose);
  });

  it("a peg holds one bottle: one pose per cell", () => {
    const m = modelOf("wall_pegs");
    expect(m.resolved.layout.semantics).toBe("single");
    expect(m.resolved.layout.cells.every((c) => c.capacity === 1)).toBe(true);
    expect(full(m).placed).toHaveLength(m.resolved.layout.cells.length);
  });
});

describe("where the index is a counter, the picture shows how many, not where", () => {
  const bins: StorageTemplateId[] = ["cube_modular", "diamond_bins", "crate_storage"];
  const bottle = (index: number) =>
    ({ id: `o${index}`, row: 1, col: 1, index, type: "red", shape: "bordeaux" }) as const;

  for (const id of bins)
    it(`${id}: three bottles lie the same way whichever counters they carry`, () => {
      const m = modelOf(id, {
        rows: 2,
        cols: 2,
        cellCapacity: STORAGE_TEMPLATES[id].cellCapacity.max,
      });
      expect(m.resolved.layout.semantics).toBe("ordinal");
      const poses = (indexes: number[]) =>
        placeBottles(m, indexes.map(bottle)).placed.map((b) => b.pose.position.join(","));
      const first = poses([1, 2, 3]);
      expect(poses([3, 7, 9])).toEqual(first);
      expect(poses([9, 3, 7])).toEqual(first);
      expect(
        poses(
          [2, 5, 12]
            .filter((i) => i <= STORAGE_TEMPLATES[id].cellCapacity.max)
            .concat([1])
            .slice(0, 3),
        ),
      ).toEqual(first);
      // take the one with the lowest counter out: the others settle, nobody stays "at 7"
      expect(poses([7, 9])).toEqual(first.slice(0, 2));
    });

  for (const id of bins)
    it(`${id}: each compartment shows exactly as many bottles as it holds, never more than it can`, () => {
      for (const c of configs(id)) {
        const m = modelOf(id, c);
        const bottles = fixtureBottles(m.resolved.layout, "partial", 3);
        const { placed } = placeBottles(m, bottles);
        for (const cell of m.resolved.layout.cells) {
          const stored = bottles.filter((b) => b.row === cell.row && b.col === cell.col).length;
          const drawn = placed.filter(
            (b) => b.address.row === cell.row && b.address.col === cell.col,
          );
          expect(drawn).toHaveLength(stored);
          expect(stored).toBeLessThanOrEqual(cell.capacity);
          expect(new Set(drawn.map((b) => b.pose.position.join(","))).size).toBe(stored);
        }
      }
    });

  it("a bottle keeps its identity in a pile: it can be picked, it is the bottle that was stored", () => {
    const m = modelOf("diamond_bins", { rows: 1, cols: 1, cellCapacity: 9 });
    const { placed } = placeBottles(m, [bottle(8), bottle(2), bottle(5)]);
    expect(placed.map((b) => [b.id, b.address.index])).toEqual([
      ["o2", 2],
      ["o5", 5],
      ["o8", 8],
    ]);
  });

  it("a pile settles from the bottom: no bottle hangs above an empty place", () => {
    for (const id of bins) {
      const m = modelOf(id, {
        rows: 1,
        cols: 1,
        cellCapacity: STORAGE_TEMPLATES[id].cellCapacity.max,
      });
      const ys = full(m).placed.map((b) => b.pose.position[1]);
      for (let i = 1; i < ys.length; i++) expect(ys[i]! + 1e-9).toBeGreaterThanOrEqual(ys[i - 1]!);
    }
  });
});

describe("the diamond rack is diamonds", () => {
  const m = modelOf("diamond_bins", { rows: 3, cols: 3, cellCapacity: 9 });

  it("its boards run diagonally, both ways", () => {
    const boards = m.parts.filter((p) => p.role === "shelf");
    expect(boards.length).toBeGreaterThan(6);
    for (const b of boards) expect(Math.abs(b.rotZ ?? 0)).toBeCloseTo(Math.PI / 4, 10);
    expect(boards.some((b) => b.rotZ! > 0) && boards.some((b) => b.rotZ! < 0)).toBe(true);
  });

  it("each compartment is a square standing on a corner: its first bottle lies in the bottom corner, alone", () => {
    const pile = (n: number) =>
      placeBottles(
        m,
        Array.from(
          { length: n },
          (_, i) =>
            ({
              id: `d${i}`,
              row: 2,
              col: 2,
              index: i + 1,
              type: "red",
              shape: "bordeaux",
            }) as const,
        ),
      ).placed;
    const [first, second, third] = pile(3).map((b) => b.pose.position);
    // one at the bottom, then two side by side above it, equally far to either side
    expect(second![1]).toBeCloseTo(third![1], 10);
    expect(second![1]).toBeGreaterThan(first![1]);
    expect((second![0] + third![0]) / 2).toBeCloseTo(first![0], 10);
    // rows of the pile grow 1, 2, 3 and shrink again: a diamond, not a box
    const rows = new Map<string, number>();
    for (const b of pile(9))
      rows.set(b.pose.position[1].toFixed(4), (rows.get(b.pose.position[1].toFixed(4)) ?? 0) + 1);
    expect(
      [...rows.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([, n]) => n),
    ).toEqual([1, 2, 3, 2, 1]);
  });

  it("a cube's pile is rows on a flat floor, a crate's is layers", () => {
    const rowsOf = (id: StorageTemplateId, cap: number) => {
      const mm = modelOf(id, { rows: 1, cols: 1, cellCapacity: cap });
      const count = new Map<string, number>();
      for (const b of full(mm).placed)
        count.set(
          b.pose.position[1].toFixed(4),
          (count.get(b.pose.position[1].toFixed(4)) ?? 0) + 1,
        );
      return [...count.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([, n]) => n);
    };
    expect(rowsOf("cube_modular", 9)).toEqual([3, 3, 3]);
    expect(rowsOf("crate_storage", 6)).toEqual([3, 3]);
    expect(rowsOf("crate_storage", 12)).toEqual([4, 4, 4]);
  });
});

describe("nothing is drawn through anything else", () => {
  for (const id of STORAGE_TEMPLATE_IDS)
    it(`${id}: no bottle cuts into a shelf, a divider, a wall or another bottle`, () => {
      for (const c of configs(id)) {
        const m = modelOf(id, c);
        const placed = full(m).placed;
        const solid = m.parts.filter((p) => !p.soft);
        let worstPart = -Infinity;
        for (const b of placed)
          for (const p of solid) worstPart = Math.max(worstPart, penetration(b.pose, p));
        expect(worstPart, `${id} ${JSON.stringify(c)}: into the furniture`).toBeLessThanOrEqual(
          1e-6,
        );
        let worstBottle = -Infinity;
        for (let i = 0; i < placed.length; i++)
          for (let j = i + 1; j < placed.length; j++)
            worstBottle = Math.max(worstBottle, overlap(placed[i]!.pose, placed[j]!.pose));
        expect(worstBottle, `${id} ${JSON.stringify(c)}: into another bottle`).toBeLessThanOrEqual(
          1e-6,
        );
      }
    });

  it("a bottle rests on something: under every bottle of a rack there is a shelf or a rail within a hair", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const m = modelOf(id);
      if (m.renderer === "bins") continue; // a pile rests on the pile
      const solid = m.parts.filter((p) => !p.soft);
      for (const b of full(m).placed.slice(0, 12)) {
        const gap = Math.min(...solid.map((p) => -penetration(b.pose, p)));
        expect(gap, `${id}: a bottle floats`).toBeLessThan(0.06);
      }
    }
  });
});

describe("a place whose arrangement is not known", () => {
  const unsure = [
    {
      name: "an unknown template",
      stored: {
        kind: "rack",
        rows: 3,
        cols: 4,
        template: "hex_rack_2031",
        cellCapacity: 4,
        semantics: "depth",
      },
    },
    {
      name: "a template of another kind",
      stored: {
        kind: "wall",
        rows: 3,
        cols: 4,
        template: "rack_double_depth",
        cellCapacity: 2,
        semantics: "depth",
      },
    },
    {
      name: "pegs stored with three bottles each",
      stored: {
        kind: "wall",
        rows: 3,
        cols: 4,
        template: "wall_pegs",
        cellCapacity: 3,
        semantics: "single",
      },
    },
    {
      name: "bins stored as depths",
      stored: {
        kind: "rack",
        rows: 2,
        cols: 3,
        template: "diamond_bins",
        cellCapacity: 8,
        semantics: "depth",
      },
    },
  ] as const;

  for (const { name, stored } of unsure)
    it(`${name}: the neutral picture, not some template's furniture`, () => {
      const resolved = resolveStorage(stored);
      expect(resolved.arrangementKnown).toBe(false);
      const m = buildModel(resolved);
      expect(m.renderer).toBe("neutral");
      expect(m.templateId).toBeNull();
      // nothing of it is a shelf, a board, a rod or a door: a plate and a tile per compartment
      expect(new Set(m.parts.map((p) => p.role))).toEqual(new Set(["neutral", "slot"]));
      expect(m.parts.filter((p) => p.role === "slot")).toHaveLength(resolved.layout.cells.length);
      expect(m.built.poseOf).toBeUndefined();
    });

  it("keeps every bottle and every spot, and claims no depth for any of them", () => {
    for (const { stored } of unsure) {
      const m = buildModel(resolveStorage(stored));
      const bottles = fixtureBottles(m.resolved.layout, "partial", 11);
      const { placed, stranded, empties } = placeBottles(m, bottles);
      expect(placed).toHaveLength(bottles.length);
      expect(stranded).toEqual([]);
      expect(placed.length + empties.length).toBe(m.resolved.layout.capacity);
      expect(new Set(placed.map((b) => b.pose.lie))).toEqual(new Set(["token"]));
      // all counters lie in one plane: nothing is in front of or behind anything
      expect(new Set(placed.map((b) => b.pose.position[2])).size).toBe(1);
      // and the same number of bottles gives the same picture whichever counters they carry
      for (const cell of m.resolved.layout.cells) {
        const here = placed.filter((b) => b.address.row === cell.row && b.address.col === cell.col);
        expect(here).toHaveLength(
          bottles.filter((b) => b.row === cell.row && b.col === cell.col).length,
        );
      }
    }
  });

  it("the same place, known, is furniture: the fallback is only for when it is not", () => {
    expect(
      buildModel(
        resolveStorage({
          kind: "rack",
          rows: 2,
          cols: 3,
          template: "diamond_bins",
          cellCapacity: 8,
          semantics: "ordinal",
        }),
      ).renderer,
    ).toBe("bins");
  });
});

describe("appearance", () => {
  it("every look a template offers gives a surface for every part, the same every time", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[id];
      for (const material of t.appearance.materials)
        for (const color of STORAGE_PALETTES[material])
          for (const lighting of t.appearance.lighting)
            for (const door of t.appearance.doors) {
              const m = modelOf(id, { appearance: { material, color, lighting, door } });
              expect(m.resolved.appearance).toMatchObject({ material, color, lighting, door });
              for (const role of MATERIAL_ROLES) expect(m.look.surfaces[role]).toBeDefined();
              expect(m.look.surfaces.frame.color).toBe(TONES[color]);
              expect(m.look.light.intensity).toBe(lighting === "none" ? 0 : 1);
              expect(m.look.surfaces.glow.emissiveIntensity).toBe(lighting === "none" ? 0 : 1.7);
              expect(lookFor(m.resolved.appearance)).toEqual(lookFor(m.resolved.appearance));
              // a door is drawn exactly when the look has one
              const hasGlass = m.parts.some((p) => p.role === "glass");
              expect(hasGlass).toBe(door === "glass");
            }
    }
  });

  it("wood is wood, metal is metal, lacquer is plain and glossy", () => {
    expect(
      lookFor({ v: 1, material: "wood", color: "walnut", lighting: "none", door: "none" }).surfaces
        .frame,
    ).toMatchObject({ kind: "wood", metalness: 0 });
    expect(
      lookFor({ v: 1, material: "metal", color: "stainless", lighting: "none", door: "none" })
        .surfaces.frame,
    ).toMatchObject({ kind: "brushed" });
    expect(
      lookFor({ v: 1, material: "metal", color: "black", lighting: "none", door: "none" }).surfaces
        .frame.kind,
    ).toBe("steel");
    expect(
      lookFor({ v: 1, material: "lacquer", color: "sage", lighting: "none", door: "none" }).surfaces
        .frame,
    ).toMatchObject({ kind: "lacquer", metalness: 0 });
  });

  it("a door never stands where a bottle is taken out: glass and solid doors are not part of what a tap can hit", () => {
    for (const id of [
      "cabinet_closed",
      "cooler_single",
      "cooler_dual",
      "cooler_undercounter",
    ] as const)
      for (const door of STORAGE_TEMPLATES[id].appearance.doors) {
        const m = modelOf(id, { appearance: { door } });
        const doorParts = m.parts.filter((p) => p.role === "glass");
        for (const p of doorParts) expect(p.soft).toBe(true);
        if (door === "glass") expect(doorParts.length).toBe(1);
      }
  });

  it("a dual-zone cooler has a bar between its zones and a light for each; a single-zone one has neither", () => {
    const dual = modelOf("cooler_dual");
    const single = modelOf("cooler_single", { rows: 8, cols: 5 });
    expect(dual.parts.filter((p) => p.role === "glowB")).toHaveLength(1);
    expect(dual.parts.filter((p) => p.role === "display").length).toBe(
      single.parts.filter((p) => p.role === "display").length + 1,
    );
    expect(single.parts.filter((p) => p.role === "glowB")).toHaveLength(0);
    // the bar takes room: the lower zone's top shelf is further below the upper zone's bottom shelf than a shelf apart
    const y = (row: number) => dual.built.poseOf!(row, 1, 1).position[1];
    expect(y(4) - y(5)).toBeGreaterThan(y(3) - y(4) + 0.3);
    expect(y(1) - y(2)).toBeCloseTo(y(2) - y(3), 10);
  });

  it("the undercounter cooler stands under a worktop, the others do not", () => {
    expect(modelOf("cooler_undercounter").parts.some((p) => p.role === "stone")).toBe(true);
    for (const id of ["cooler_single", "cooler_dual", "cabinet_closed"] as const)
      expect(modelOf(id).parts.some((p) => p.role === "stone")).toBe(false);
  });
});

describe("the camera", () => {
  const inView = (m: RenderModel, aspect: number) => {
    const f = frameFor(m.bounds, aspect);
    const tan = Math.tan((FOV * Math.PI) / 360);
    const size = [0, 1, 2].map((i) => m.bounds.max[i]! - m.bounds.min[i]!);
    // seen from the front at the starting distance: the front face of the place fits
    const toFront = f.distance - size[2]! / 2;
    return {
      f,
      fitsHeight: size[1]! / 2 <= toFront * tan + 1e-9,
      fitsWidth: (size[0]! * Math.cos(START_AZIMUTH)) / 2 <= toFront * tan * aspect + 1e-9,
    };
  };

  it("frames the smallest and the largest place of every template, on a phone held upright and on a wide screen", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[id];
      const big = { rows: t.rows.max, cols: t.cols.max, cellCapacity: t.cellCapacity.min };
      const largest =
        big.rows * big.cols * big.cellCapacity <= t.maxCapacity
          ? big
          : {
              rows: t.rows.max,
              cols: Math.floor(t.maxCapacity / (t.rows.max * t.cellCapacity.min)),
              cellCapacity: t.cellCapacity.min,
            };
      for (const c of [
        { rows: t.rows.min, cols: t.cols.min, cellCapacity: t.cellCapacity.min },
        largest,
      ])
        for (const aspect of [0.5, 1, 2.2]) {
          const { f, fitsHeight, fitsWidth } = inView(modelOf(id, c), aspect);
          expect(Number.isFinite(f.distance) && f.distance > 0).toBe(true);
          expect(fitsHeight && fitsWidth, `${id} ${JSON.stringify(c)} at ${aspect}`).toBe(true);
          expect(f.reach.x).toBeGreaterThan(0);
          expect(f.reach.y).toBeGreaterThan(0);
        }
    }
  });

  it("holds every bottle, not only what carries it: on rails and pegs a bottle reaches past its mount", () => {
    const cases: Array<
      [StorageTemplateId, { rows?: number; cols?: number; cellCapacity?: number }]
    > = [
      ...STORAGE_TEMPLATE_IDS.map((id): [StorageTemplateId, object] => [id, {}]),
      ["wall_rails", { rows: 6, cols: 3, cellCapacity: 2 }],
      ["wall_rails", { rows: 1, cols: 8, cellCapacity: 3 }],
      ["wall_pegs", { rows: 1, cols: 1 }],
      ["rack_double_depth", { rows: 1, cols: 1, cellCapacity: 3 }],
    ];
    for (const [id, c] of cases) {
      const m = modelOf(id, c);
      for (const b of full(m).placed) {
        const box = poseBounds(b.pose);
        for (let i = 0; i < 3; i++) {
          expect(box.min[i], `${id} ${JSON.stringify(c)} ${b.id}`).toBeGreaterThanOrEqual(
            m.bounds.min[i]! - 1e-9,
          );
          expect(box.max[i], `${id} ${JSON.stringify(c)} ${b.id}`).toBeLessThanOrEqual(
            m.bounds.max[i]! + 1e-9,
          );
        }
      }
    }
  });

  it("looks at the middle of the place, and stands further back for a larger one", () => {
    const small = modelOf("rack_classic", { rows: 2, cols: 2 });
    const large = modelOf("rack_classic", { rows: 30, cols: 30 });
    expect(frameFor(large.bounds, 1).distance).toBeGreaterThan(
      frameFor(small.bounds, 1).distance * 5,
    );
    const f = frameFor(small.bounds, 1);
    for (let i = 0; i < 3; i++)
      expect(f.target[i]).toBeCloseTo((small.bounds.min[i]! + small.bounds.max[i]!) / 2, 10);
    // nothing to look at: still a camera
    expect(frameFor({ min: [0, 0, 0], max: [0, 0, 0] }, 1).distance).toBeGreaterThan(0);
  });
});

describe("how finely a scene is drawn", () => {
  it("fewer triangles and plainer glass as there is more to draw, a step lower on a small phone", () => {
    expect(qualityFor(40, false)).toBe("high");
    expect(qualityFor(200, false)).toBe("balanced");
    expect(qualityFor(900, false)).toBe("low");
    expect(qualityFor(1200, false)).toBe("low");
    expect(qualityFor(40, true)).toBe("balanced");
    expect(qualityFor(200, true)).toBe("low");
    expect(QUALITY.high.radial).toBeGreaterThan(QUALITY.balanced.radial);
    expect(QUALITY.balanced.radial).toBeGreaterThan(QUALITY.low.radial);
    expect(QUALITY.low.clearcoat).toBe(false);
    expect([lowerQuality("high"), lowerQuality("balanced"), lowerQuality("low")]).toEqual([
      "balanced",
      "low",
      null,
    ]);
  });

  it("the level never changes what is drawn where: placement does not know about it", () => {
    const m = modelOf("rack_double_depth", { rows: 30, cols: 20, cellCapacity: 2 });
    expect(full(m).placed).toHaveLength(1200);
  });
});
