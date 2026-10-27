import type { Point } from "@cellr/domain";

/**
 * Zooming the label framer. The photo sits in a fixed box (w × h) and is drawn at `scale`, shifted by (x, y) px,
 * with its origin top-left. Only the view moves: the crop corners stay normalised to the photo itself (0..1 of
 * its width and height), so zooming can never change what is cut out.
 */
export interface FramerView {
  scale: number;
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
export const WHOLE_PHOTO: FramerView = { scale: 1, x: 0, y: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keeps the zoom in range and the photo covering the box (no empty edges when zoomed in). */
export function clampView(view: FramerView, w: number, h: number): FramerView {
  const scale = clamp(view.scale, MIN_ZOOM, MAX_ZOOM);
  return {
    scale,
    x: clamp(view.x, w - w * scale, 0),
    y: clamp(view.y, h - h * scale, 0),
  };
}

/** Zoom to `scale` while the photo point under `at` (box px) stays under `at` (a pinch's midpoint, a button's centre). */
export function zoomAt(
  view: FramerView,
  scale: number,
  at: Point,
  w: number,
  h: number,
): FramerView {
  const next = clamp(scale, MIN_ZOOM, MAX_ZOOM);
  const px = (at.x - view.x) / view.scale;
  const py = (at.y - view.y) / view.scale;
  return clampView({ scale: next, x: at.x - px * next, y: at.y - py * next }, w, h);
}

/**
 * A two-finger gesture from its start: zoom by how far the fingers spread, centred where they started, and follow
 * their midpoint as it moves (so zooming and panning happen in one natural motion).
 */
export function pinchView(
  start: { view: FramerView; distance: number; mid: Point },
  distance: number,
  mid: Point,
  w: number,
  h: number,
): FramerView {
  if (start.distance <= 0) return start.view;
  const scale = clamp(start.view.scale * (distance / start.distance), MIN_ZOOM, MAX_ZOOM);
  const px = (start.mid.x - start.view.x) / start.view.scale;
  const py = (start.mid.y - start.view.y) / start.view.scale;
  return clampView({ scale, x: mid.x - px * scale, y: mid.y - py * scale }, w, h);
}

/** One finger on the zoomed photo: move it with the finger. */
export const panView = (start: FramerView, dx: number, dy: number, w: number, h: number) =>
  clampView({ ...start, x: start.x + dx, y: start.y + dy }, w, h);

/** Box px → a point on the photo (0..1), whatever the zoom; clamped to the photo. */
export function toPhoto(at: Point, view: FramerView, w: number, h: number): Point {
  return {
    x: clamp((at.x - view.x) / view.scale / w, 0, 1),
    y: clamp((at.y - view.y) / view.scale / h, 0, 1),
  };
}

/** A point on the photo (0..1) → box px at this zoom (where its corner handle is drawn). */
export const toBox = (p: Point, view: FramerView, w: number, h: number): Point => ({
  x: view.x + p.x * w * view.scale,
  y: view.y + p.y * h * view.scale,
});
