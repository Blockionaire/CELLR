import { describe, expect, it } from "vitest";
import {
  clampLabelAspect,
  DEFAULT_QUAD,
  flatSize,
  isUsableQuad,
  quadFromNumbers,
  type Quad,
} from "./label-crop";

const q = (...n: number[]) => quadFromNumbers(n)!;

describe("a believable label", () => {
  it("accepts the default frame and a tilted one", () => {
    expect(isUsableQuad(DEFAULT_QUAD, 1200, 1600)).toBe(true);
    expect(isUsableQuad(q(0.2, 0.15, 0.85, 0.2, 0.8, 0.85, 0.15, 0.8), 1200, 1600)).toBe(true);
  });
  it("refuses corners in the wrong order, folded in, or twisted", () => {
    // anticlockwise
    expect(isUsableQuad(q(0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.9, 0.1), 1000, 1000)).toBe(false);
    // a bow tie
    expect(isUsableQuad(q(0.1, 0.1, 0.9, 0.9, 0.9, 0.1, 0.1, 0.9), 1000, 1000)).toBe(false);
    // one corner pushed inside (a dent)
    expect(isUsableQuad(q(0.1, 0.1, 0.9, 0.1, 0.5, 0.4, 0.1, 0.9), 1000, 1000)).toBe(false);
  });
  it("refuses a speck, a sliver, and a degenerate shape", () => {
    expect(isUsableQuad(q(0.4, 0.4, 0.5, 0.4, 0.5, 0.5, 0.4, 0.5), 1000, 1000)).toBe(false);
    expect(isUsableQuad(q(0.1, 0.1, 0.9, 0.1, 0.9, 0.13, 0.1, 0.13), 1000, 1000)).toBe(false);
    expect(isUsableQuad(q(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5), 1000, 1000)).toBe(false);
    expect(isUsableQuad(DEFAULT_QUAD, 0, 100)).toBe(false);
  });
});

describe("numbers from a model", () => {
  it("makes a quad, keeps it inside the photo, and says no to nonsense", () => {
    expect(quadFromNumbers([0, 0, 1, 0, 1, 1, 0, 1])).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
    expect(quadFromNumbers([-1, 0, 2, 0, 1, 1, 0, 1])![0]).toEqual({ x: 0, y: 0 });
    expect(quadFromNumbers([0, 0, 1])).toBeNull();
    expect(quadFromNumbers([0, 0, 1, 0, 1, 1, 0, NaN])).toBeNull();
    expect(quadFromNumbers(null)).toBeNull();
  });
});

describe("the straightened label", () => {
  const upright: Quad = DEFAULT_QUAD;
  it("is as big as the label is in the photo, and no bigger than allowed", () => {
    expect(flatSize(upright, 1000, 1000, 2000)).toEqual({ width: 760, height: 800 });
    expect(flatSize(upright, 1000, 1000, 400)).toEqual({ width: 380, height: 400 });
  });
  it("uses the longer of two opposite edges (a label seen at an angle)", () => {
    const tilted = q(0.1, 0.1, 0.9, 0.2, 0.9, 0.8, 0.1, 0.9);
    const { width, height } = flatSize(tilted, 1000, 1000, 5000);
    expect(width).toBe(806);
    expect(height).toBe(800);
  });
  it("keeps the proportions within what a bottle can wear", () => {
    expect(clampLabelAspect(100, 1000)).toBe(0.45);
    expect(clampLabelAspect(1000, 100)).toBe(2.4);
    expect(clampLabelAspect(600, 800)).toBe(0.75);
  });
});
