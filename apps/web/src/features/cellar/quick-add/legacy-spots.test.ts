import { describe, expect, it } from "vitest";
import { STORAGE_KINDS, resolveStorage, type Occupant, type StoredStorage } from "@cellr/domain";
import * as THREE from "three";
import { BOTTLE_LENGTH } from "../three/layout";
import { rackMatrix } from "../three/pose";
import { legacyPointing, type LegacyDrawn } from "./legacy-spots";
import { freeSpots, type FreeSpot } from "./spots";

/**
 * 3D Quick Add on a place from before templates (sprint 7.2 completion): a free spot is pointed at in the existing
 * view only where that view has an exact place for it, and the place there is the one a bottle on that spot is drawn
 * in. Positions are worked out here from the pinned formula (legacy-parity.test.ts), not taken from the code.
 */

const occ = (spots: Array<[number, number]>): Occupant[] =>
  spots.map(([row, col], i) => ({ bottleId: `b${i}`, row, col, index: 1 }));
const drawnOf = (
  stored: { kind: string; rows: number; cols: number },
  taken: Array<[number, number]>,
): LegacyDrawn => ({
  rows: stored.rows,
  cols: stored.cols,
  kind: stored.kind,
  taken: taken.map(([row, col]) => ({ row, col })),
});
function point(stored: StoredStorage, taken: Array<[number, number]>, drawn?: LegacyDrawn) {
  const resolved = resolveStorage(stored);
  const free = freeSpots(resolved, occ(taken));
  return {
    free,
    at: legacyPointing(resolved, drawn ?? drawnOf(stored as never, taken), free),
  };
}
const centre = (row: number, col: number, rows: number, cols: number) => [
  col - (cols + 1) / 2,
  (rows + 1) / 2 - row,
  0,
];

describe("which places from before templates are pointed at in the existing 3D view", () => {
  it("every kind the app knows: each free spot, and only the free ones, at the centre a bottle there is drawn at", () => {
    for (const kind of STORAGE_KINDS) {
      const stored = { kind, rows: 4, cols: 3 };
      const taken: Array<[number, number]> = [
        [1, 1],
        [2, 3],
        [4, 2],
      ];
      const { free, at } = point(stored, taken);
      expect(at.ok, kind).toBe(true);
      if (!at.ok) continue;
      expect(at.rows).toBe(4);
      expect(at.cols).toBe(3);
      // the domain's free spots, in its order, none taken, all index 1
      expect(at.spots.map((s) => s.spot)).toEqual(free);
      expect(at.spots).toHaveLength(12 - 3);
      for (const s of at.spots) {
        expect(s.spot.index).toBe(1);
        expect(taken.some(([r, c]) => r === s.spot.row && c === s.spot.col)).toBe(false);
        expect(s.position).toEqual(centre(s.spot.row, s.spot.col, 4, 3));
        // the middle of the bottle the existing view draws on that spot (rackMatrix; modelled standing on y = 0)
        const middle = new THREE.Vector3(0, BOTTLE_LENGTH / 2, 0).applyMatrix4(
          rackMatrix(s.spot.row, s.spot.col, 4, 3),
        );
        middle.toArray().forEach((v, i) => expect(v).toBeCloseTo(s.position[i]!, 12));
      }
    }
  });

  it("bounds: the smallest place, the largest, its corners; an empty place offers every spot, a full one none", () => {
    const one = point({ kind: "rack", rows: 1, cols: 1 }, []);
    expect(one.at).toMatchObject({
      ok: true,
      spots: [{ spot: { row: 1, col: 1 }, position: [0, 0, 0] }],
    });
    const big = point({ kind: "cabinet", rows: 30, cols: 30 }, [[1, 1]]);
    expect(big.at.ok).toBe(true);
    if (big.at.ok) {
      expect(big.at.spots).toHaveLength(899);
      const corner = big.at.spots.find((s) => s.spot.row === 30 && s.spot.col === 30)!;
      expect(corner.position).toEqual([14.5, -14.5, 0]);
      const first = big.at.spots.find((s) => s.spot.row === 1 && s.spot.col === 2)!;
      expect(first.position).toEqual([-13.5, 14.5, 0]);
      expect(big.at.spots.some((s) => s.spot.row === 1 && s.spot.col === 1)).toBe(false);
    }
    const all: Array<[number, number]> = [];
    for (let r = 1; r <= 2; r++) for (let c = 1; c <= 3; c++) all.push([r, c]);
    expect(point({ kind: "wall", rows: 2, cols: 3 }, all).at).toEqual({
      ok: true,
      rows: 2,
      cols: 3,
      spots: [],
    });
  });

  it("refused (the list stays): a place with a template, or more than one bottle per cell (a pile from before templates)", () => {
    expect(
      point({ kind: "rack", rows: 3, cols: 4, template: "rack_classic", semantics: "depth" }, [])
        .at,
    ).toEqual({ ok: false, reason: "not_legacy" });
    const pile = point({ kind: "rack", rows: 2, cols: 2, cellCapacity: 3 }, []);
    expect(pile.at).toEqual({ ok: false, reason: "not_legacy" });
  });

  it("refused: a stored kind the app does not know, a size outside the limits (what is drawn may not be what is stored)", () => {
    expect(point({ kind: "barrel" as never, rows: 2, cols: 2 }, []).at).toEqual({
      ok: false,
      reason: "fallback",
    });
    expect(
      point(
        { kind: "rack", rows: 40, cols: 2 },
        [],
        drawnOf({ kind: "rack", rows: 30, cols: 2 }, []),
      ).at,
    ).toEqual({ ok: false, reason: "fallback" });
    // the existing view's read names a kind the app does not know
    expect(
      point(
        { kind: "rack", rows: 2, cols: 2 },
        [],
        drawnOf({ kind: "barrel", rows: 2, cols: 2 }, []),
      ).at,
    ).toEqual({ ok: false, reason: "unknown_kind" });
  });

  it("refused: the two reads disagree (another size, another kind, a drawn bottle on a spot called free)", () => {
    const stored = { kind: "fridge" as const, rows: 3, cols: 3 };
    expect(point(stored, [], drawnOf({ ...stored, rows: 4 }, [])).at).toEqual({
      ok: false,
      reason: "reads_differ",
    });
    expect(point(stored, [], drawnOf({ ...stored, cols: 2 }, [])).at).toEqual({
      ok: false,
      reason: "reads_differ",
    });
    expect(point(stored, [], drawnOf({ ...stored, kind: "rack" }, [])).at).toEqual({
      ok: false,
      reason: "reads_differ",
    });
    expect(point(stored, [], drawnOf(stored, [[2, 2]])).at).toEqual({
      ok: false,
      reason: "reads_differ",
    });
  });

  it("refused: a spot outside the grid, or past index 1 (depth is off): the whole place, never one spot dropped", () => {
    const resolved = resolveStorage({ kind: "rack", rows: 2, cols: 2 });
    const drawn = drawnOf({ kind: "rack", rows: 2, cols: 2 }, []);
    const outside: FreeSpot[] = [
      { row: 1, col: 1, index: 1 },
      { row: 3, col: 1, index: 1 },
    ];
    expect(legacyPointing(resolved, drawn, outside)).toEqual({ ok: false, reason: "spot_outside" });
    const deep = [{ row: 1, col: 1, index: 2 }] as unknown as FreeSpot[];
    expect(legacyPointing(resolved, drawn, deep)).toEqual({ ok: false, reason: "spot_outside" });
  });

  it("refused: anything the domain does not read as one place per spot", () => {
    const resolved = resolveStorage({ kind: "rack", rows: 2, cols: 2 });
    const drawn = drawnOf({ kind: "rack", rows: 2, cols: 2 }, []);
    // a layout that is not the whole grid of one-bottle cells (as a template's diamond would be)
    const holed = {
      ...resolved,
      layout: { ...resolved.layout, cells: resolved.layout.cells.slice(1) },
    };
    expect(legacyPointing(holed, drawn, [])).toEqual({ ok: false, reason: "not_a_grid" });
    const deep = {
      ...resolved,
      layout: {
        ...resolved.layout,
        cells: resolved.layout.cells.map((c) => ({ ...c, capacity: 2 })),
      },
    };
    expect(legacyPointing(deep, drawn, [])).toMatchObject({ ok: false });
    const unknown = { ...resolved, arrangementKnown: false };
    expect(legacyPointing(unknown, drawn, [])).toEqual({ ok: false, reason: "not_single" });
  });
});
