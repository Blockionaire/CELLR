import type { Point } from "@cellr/domain";

/** A 3×3 matrix, row by row. */
export type Matrix3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * The perspective map that sends the unit square (0,0)-(1,1) onto four corners (in the order top-left,
 * top-right, bottom-right, bottom-left), in the photo's own pixels. This is how a label seen at an angle is
 * made flat again: for each point of the flat label, where in the photo does it come from?
 */
export function squareToQuad(q: readonly [Point, Point, Point, Point]): Matrix3 {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x;
  const sy = p0.y - p1.y + p2.y - p3.y;
  let g = 0;
  let h = 0;
  if (Math.abs(sx) > 1e-12 || Math.abs(sy) > 1e-12) {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / det;
    h = (dx1 * sy - sx * dy1) / det;
  }
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ];
}

export function applyMatrix(m: Matrix3, u: number, v: number): Point {
  const w = m[6] * u + m[7] * v + m[8];
  return { x: (m[0] * u + m[1] * v + m[2]) / w, y: (m[3] * u + m[4] * v + m[5]) / w };
}

/**
 * The affine transform (a, b, c, d, e, f as the canvas wants them) that carries three source points onto
 * three destination points. A mesh of small triangles, each carried this way, approximates the perspective map
 * as closely as you like.
 */
export function affineFromTriangles(
  src: readonly [Point, Point, Point],
  dst: readonly [Point, Point, Point],
): [number, number, number, number, number, number] {
  const [s0, s1, s2] = src;
  const [d0, d1, d2] = dst;
  const det = s0.x * (s1.y - s2.y) - s0.y * (s1.x - s2.x) + (s1.x * s2.y - s2.x * s1.y);
  const solve = (v0: number, v1: number, v2: number) => ({
    x: (v0 * (s1.y - s2.y) + v1 * (s2.y - s0.y) + v2 * (s0.y - s1.y)) / det,
    y: (v0 * (s2.x - s1.x) + v1 * (s0.x - s2.x) + v2 * (s1.x - s0.x)) / det,
    c:
      (v0 * (s1.x * s2.y - s2.x * s1.y) +
        v1 * (s2.x * s0.y - s0.x * s2.y) +
        v2 * (s0.x * s1.y - s1.x * s0.y)) /
      det,
  });
  const X = solve(d0.x, d1.x, d2.x);
  const Y = solve(d0.y, d1.y, d2.y);
  return [X.x, Y.x, X.y, Y.y, X.c, Y.c];
}
