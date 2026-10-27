import { describe, expect, it } from "vitest";
import {
  clampView,
  MAX_ZOOM,
  panView,
  pinchView,
  toBox,
  toPhoto,
  WHOLE_PHOTO,
  zoomAt,
} from "./framer-zoom";

const W = 300;
const H = 400;
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe("zooming the label framer never changes the crop", () => {
  it("a point on the photo maps to the same photo point at any zoom and pan", () => {
    const corner = { x: 0.37, y: 0.81 };
    for (const scale of [1, 1.5, 2.25, 3, MAX_ZOOM]) {
      for (const at of [
        { x: 0, y: 0 },
        { x: 150, y: 200 },
        { x: 300, y: 400 },
      ]) {
        const view = zoomAt(WHOLE_PHOTO, scale, at, W, H);
        close(toPhoto(toBox(corner, view, W, H), view, W, H), corner);
      }
    }
  });

  it("without zoom, box and photo coordinates are the plain fractions", () => {
    close(toPhoto({ x: 75, y: 100 }, WHOLE_PHOTO, W, H), { x: 0.25, y: 0.25 });
  });

  it("zooming at a point keeps that point under the finger", () => {
    const at = { x: 120, y: 260 };
    const before = toPhoto(at, WHOLE_PHOTO, W, H);
    const view = zoomAt(WHOLE_PHOTO, 3, at, W, H);
    close(toPhoto(at, view, W, H), before);
  });

  it("a pinch zooms by the spread and follows the midpoint", () => {
    const start = { view: WHOLE_PHOTO, distance: 100, mid: { x: 150, y: 200 } };
    const zoomed = pinchView(start, 200, { x: 150, y: 200 }, W, H);
    expect(zoomed.scale).toBe(2);
    close(toPhoto({ x: 150, y: 200 }, zoomed, W, H), { x: 0.5, y: 0.5 });
    const moved = pinchView(
      { ...start, view: zoomed, distance: 200 },
      200,
      { x: 130, y: 200 },
      W,
      H,
    );
    expect(moved.x).toBe(zoomed.x - 20);
  });

  it("stays in range: never smaller than the whole photo, never past the edges, never beyond the maximum", () => {
    expect(clampView({ scale: 0.4, x: 50, y: 50 }, W, H)).toEqual(WHOLE_PHOTO);
    expect(zoomAt(WHOLE_PHOTO, 50, { x: 0, y: 0 }, W, H).scale).toBe(MAX_ZOOM);
    const panned = panView({ scale: 2, x: 0, y: 0 }, 9999, -9999, W, H);
    expect(panned).toEqual({ scale: 2, x: 0, y: -H });
  });

  it("a point off the photo is clamped onto its edge", () => {
    const view = zoomAt(WHOLE_PHOTO, 2, { x: 0, y: 0 }, W, H);
    expect(toPhoto({ x: -40, y: 9999 }, view, W, H)).toEqual({ x: 0, y: 1 });
  });
});
