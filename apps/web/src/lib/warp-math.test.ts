import { describe, expect, it } from "vitest";
import { affineFromTriangles, applyMatrix, squareToQuad } from "./warp-math";

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("squareToQuad", () => {
  it("sends the corners of the square to the corners of the quad", () => {
    const quad = [
      { x: 100, y: 50 },
      { x: 700, y: 120 },
      { x: 650, y: 900 },
      { x: 80, y: 820 },
    ] as const;
    const m = squareToQuad(quad);
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].forEach(([u, v], i) => {
      const p = applyMatrix(m, u!, v!);
      near(p.x, quad[i]!.x);
      near(p.y, quad[i]!.y);
    });
  });

  it("is the plain scale and shift when the quad is a rectangle", () => {
    const m = squareToQuad([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 220 },
      { x: 10, y: 220 },
    ]);
    const p = applyMatrix(m, 0.5, 0.25);
    near(p.x, 60);
    near(p.y, 70);
  });

  it("puts the middle where the diagonals cross (a perspective map, not a plain blend)", () => {
    // A trapezoid: the top is narrower, as a label tilted away from the camera is.
    const m = squareToQuad([
      { x: 30, y: 0 },
      { x: 70, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    const middle = applyMatrix(m, 0.5, 0.5);
    near(middle.x, 50);
    // where the two diagonals cross, not half way down: the far (narrow) end is squeezed into less picture
    near(middle.y, 100 * (40 / 140));
  });
});

describe("affineFromTriangles", () => {
  it("carries three points onto three points", () => {
    const src = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ] as const;
    const dst = [
      { x: 5, y: 5 },
      { x: 25, y: 5 },
      { x: 5, y: 35 },
    ] as const;
    const [a, b, c, d, e, f] = affineFromTriangles(src, dst);
    src.forEach((s, i) => {
      near(a * s.x + c * s.y + e, dst[i]!.x);
      near(b * s.x + d * s.y + f, dst[i]!.y);
    });
  });
});
