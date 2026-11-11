/**
 * The pixel work behind the hero's clean bottle, on plain RGBA data (no canvas), so it can be tested on its own.
 */

/** At or below this alpha a pixel is "empty" (the bottle outline measure in bottle-art-image uses the same). */
export const ALPHA_FLOOR = 24;

/** The four corners of the picture: on a picture with a transparent background they are empty. */
export function cornersOpaque(data: Uint8ClampedArray, w: number, h: number): boolean {
  const s = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  for (const [x0, y0] of [
    [0, 0],
    [w - s, 0],
    [0, h - s],
    [w - s, h - s],
  ] as const) {
    let sum = 0;
    for (let y = y0; y < y0 + s; y++)
      for (let x = x0; x < x0 + s; x++) sum += data[(y * w + x) * 4 + 3]!;
    if (sum / (s * s) > 128) return true;
  }
  return false;
}

/**
 * Makes every pixel at or below ALPHA_FLOOR fully transparent (in place: a faint veil or haze over a picture's
 * background is gone, the bottle untouched) and returns the box around what is left, with one pixel of air; null when
 * nothing is left.
 */
export function clearFaintAndMeasure(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4 + 3;
      if (data[i]! <= ALPHA_FLOOR) data[i] = 0;
      else {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  if (maxX < 0) return null;
  minX = Math.max(0, minX - 1);
  minY = Math.max(0, minY - 1);
  maxX = Math.min(w - 1, maxX + 1);
  maxY = Math.min(h - 1, maxY + 1);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
