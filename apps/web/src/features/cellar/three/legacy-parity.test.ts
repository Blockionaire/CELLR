import { describe, expect, it } from "vitest";
import {
  STORAGE_KINDS,
  enumerateSlots,
  nextFreeSlots,
  resolveStorage,
  toLegacySlot,
} from "@cellr/domain";
import {
  BOTTLE_LENGTH,
  FRAME,
  RACK_DEPTH,
  SLOT,
  STORAGE_LOOK,
  slotPosition,
  unitSize,
} from "./layout";
import { rackMatrix, TILT } from "./pose";

/**
 * Smart Cellar 3D, sprint 1A. The storage templates and the layout engine arrive in the domain package WITHOUT the
 * 3D view changing: a place from before templates is drawn from its rows and columns exactly as it always was.
 * These tests pin that drawing (where a bottle lies, and how), in numbers worked out here and not taken from the
 * code under test, so that when the renderer starts reading layouts a moved bottle shows up as a failure.
 */

describe("where a bottle lies in an existing place (pinned)", () => {
  it("the measures everything else is built from", () => {
    expect(SLOT).toBe(1);
    expect(BOTTLE_LENGTH).toBe(3.4);
    expect(RACK_DEPTH).toBeCloseTo(3.6, 12);
    expect(FRAME).toBe(0.14);
    expect(TILT).toBe(0.04);
  });

  it("a spot's centre: one slot apart, the grid centred on the origin, shelf 1 on top", () => {
    expect(slotPosition(1, 1, 5, 4)).toEqual([-1.5, 2, 0]);
    expect(slotPosition(5, 4, 5, 4)).toEqual([1.5, -2, 0]);
    expect(slotPosition(3, 2, 5, 4)).toEqual([-0.5, 0, 0]);
    expect(slotPosition(1, 1, 30, 30)).toEqual([-14.5, 14.5, 0]);
    expect(slotPosition(30, 30, 30, 30)).toEqual([14.5, -14.5, 0]);
    expect(slotPosition(1, 1, 1, 1)).toEqual([0, 0, 0]);
  });

  it("every spot of every size, against the formula", () => {
    for (let rows = 1; rows <= 30; rows += 1)
      for (let cols = 1; cols <= 30; cols += 1)
        for (const [row, col] of [
          [1, 1],
          [rows, cols],
          [Math.ceil(rows / 2), Math.ceil(cols / 3)],
        ] as const)
          expect(slotPosition(row, col, rows, cols)).toEqual([
            col - (cols + 1) / 2,
            (rows + 1) / 2 - row,
            0,
          ]);
  });

  it("a place's front: its slots and a board on each side", () => {
    expect(unitSize(5, 4)).toEqual({ width: 4 + 2 * 0.14, height: 5 + 2 * 0.14 });
    expect(unitSize(30, 30)).toEqual({ width: 30.28, height: 30.28 });
  });

  it("a bottle's pose: on its side, neck towards you and a little up, turning about its middle", () => {
    // the rotation about x by (90° - tilt), then the bottle's middle (it is modelled standing on y = 0) on the spot
    const a = Math.PI / 2 - 0.04;
    const half = 3.4 / 2;
    for (const [row, col, rows, cols] of [
      [1, 1, 5, 4],
      [5, 4, 5, 4],
      [3, 7, 30, 30],
      [1, 1, 1, 1],
    ] as const) {
      const [x, y] = [col - (cols + 1) / 2, (rows + 1) / 2 - row];
      const expected = [
        ...[1, 0, 0, 0],
        ...[0, Math.cos(a), Math.sin(a), 0],
        ...[0, -Math.sin(a), Math.cos(a), 0],
        ...[x, y - half * Math.cos(a), -half * Math.sin(a), 1],
      ];
      const got = rackMatrix(row, col, rows, cols).elements;
      expect(got).toHaveLength(16);
      got.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 12));
    }
  });
});

describe("an existing place, read through the new layout, is the place the 3D view draws", () => {
  it("every kind: one drawn spot for each spot of the layout, each somewhere else, in the old filling order", () => {
    for (const kind of STORAGE_KINDS) {
      const [rows, cols] = [6, 5];
      const { layout, legacy } = resolveStorage({ kind, rows, cols });
      expect(legacy).toBe(true);
      const spots = enumerateSlots(layout).map(toLegacySlot);
      // every spot has the two-coordinate form the renderer takes
      expect(spots).not.toContain(null);
      expect(spots).toEqual(nextFreeSlots({ rows, cols }, [], rows * cols));
      const drawn = new Set(spots.map((s) => slotPosition(s!.row, s!.col, rows, cols).join(",")));
      expect(drawn.size).toBe(rows * cols);
      // and the kind still has the look it is drawn in
      expect(STORAGE_LOOK[kind]).toBeDefined();
    }
  });
});
