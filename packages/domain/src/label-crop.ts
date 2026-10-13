import { z } from "zod";

/**
 * FINDING THE LABEL IN A PHOTO. A label is four corners on a picture, in the order top-left, top-right,
 * bottom-right, bottom-left, each as a fraction of the photo (0 to 1, y downwards). The AI may suggest them,
 * the person can drag them, and the phone straightens what lies between them into a flat picture of the label
 * that is wrapped round the 3D bottle. Everything here is plain geometry, so it can be checked.
 */

export const PointSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export type Point = z.infer<typeof PointSchema>;

export const QuadSchema = z.tuple([PointSchema, PointSchema, PointSchema, PointSchema]);
export type Quad = z.infer<typeof QuadSchema>;

/** Where to start when nothing is known: the middle of the photo, with a margin. */
export const DEFAULT_QUAD: Quad = [
  { x: 0.12, y: 0.1 },
  { x: 0.88, y: 0.1 },
  { x: 0.88, y: 0.9 },
  { x: 0.12, y: 0.9 },
];

const dist = (a: Point, b: Point, w: number, h: number) =>
  Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);

/**
 * Whether four corners make a believable label: in clockwise order, no corner folded inward, and big
 * enough to be worth wrapping round a bottle. `width` and `height` are the photo's, so that an edge
 * is measured in real pixels and not in fractions.
 */
export function isUsableQuad(quad: Quad, width: number, height: number): boolean {
  if (width < 1 || height < 1) return false;
  const p = quad.map((q) => ({ x: q.x * width, y: q.y * height }));
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % 4]!;
    const c = p[(i + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross <= 0) return false; // clockwise on a screen (y down) turns the same way at every corner
    sign += 1;
  }
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % 4]!;
    area += a.x * b.y - b.x * a.y;
  }
  area = Math.abs(area) / 2;
  const shortSide = Math.min(width, height);
  const edges = [0, 1, 2, 3].map((i) => dist(quad[i]!, quad[(i + 1) % 4]!, width, height));
  return sign === 4 && area >= 0.04 * width * height && Math.min(...edges) >= 0.08 * shortSide;
}

/** Eight numbers (x1, y1, … x4, y4) from a model, as a quad, or null when they cannot be one. */
export function quadFromNumbers(values: readonly number[] | null | undefined): Quad | null {
  if (!values || values.length !== 8 || values.some((v) => !Number.isFinite(v))) return null;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const point = (i: number): Point => ({ x: clamp(values[i * 2]!), y: clamp(values[i * 2 + 1]!) });
  return [point(0), point(1), point(2), point(3)];
}

/**
 * How big the straightened label is: as wide as its wider edge and as tall as its taller edge, shrunk to
 * fit `maxEdge` (never enlarged beyond the photo's own pixels).
 */
export function flatSize(
  quad: Quad,
  photoWidth: number,
  photoHeight: number,
  maxEdge: number,
): { width: number; height: number } {
  const top = dist(quad[0], quad[1], photoWidth, photoHeight);
  const bottom = dist(quad[3], quad[2], photoWidth, photoHeight);
  const left = dist(quad[0], quad[3], photoWidth, photoHeight);
  const right = dist(quad[1], quad[2], photoWidth, photoHeight);
  const w = Math.max(top, bottom);
  const h = Math.max(left, right);
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return {
    width: Math.max(16, Math.round(w * scale)),
    height: Math.max(16, Math.round(h * scale)),
  };
}

/** Width over height of the label as it is wrapped round the bottle, kept within what a bottle can carry. */
export const clampLabelAspect = (width: number, height: number): number =>
  Math.min(2.4, Math.max(0.45, width / Math.max(1, height)));
