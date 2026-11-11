import { describe, expect, it } from "vitest";
import { ALPHA_FLOOR, clearFaintAndMeasure, cornersOpaque } from "./hero-art-pixels";

/** A w×h picture, every pixel this alpha; `bottle` paints an opaque block. */
function picture(
  w: number,
  h: number,
  alpha: number,
  bottle?: { x: number; y: number; w: number; h: number },
) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = 255;
    d[i * 4 + 1] = 255;
    d[i * 4 + 2] = 255;
    d[i * 4 + 3] = alpha;
  }
  if (bottle)
    for (let y = bottle.y; y < bottle.y + bottle.h; y++)
      for (let x = bottle.x; x < bottle.x + bottle.w; x++) {
        d[(y * w + x) * 4] = 40;
        d[(y * w + x) * 4 + 3] = 255;
      }
  return d;
}
const alphas = (d: Uint8ClampedArray) => [...d].filter((_, i) => i % 4 === 3);

describe("the hero's clean bottle", () => {
  const bottle = { x: 40, y: 10, w: 20, h: 80 };

  it("a faint veil over the background is made fully transparent; the bottle is untouched and measured", () => {
    const d = picture(100, 100, 14, bottle);
    expect(clearFaintAndMeasure(d, 100, 100)).toEqual({ x: 39, y: 9, w: 22, h: 82 });
    const a = alphas(d);
    expect(a.filter((v) => v > 0 && v <= ALPHA_FLOOR)).toHaveLength(0);
    expect(a.filter((v) => v === 255)).toHaveLength(20 * 80);
  });

  it("a clean transparent picture stays as it is", () => {
    const d = picture(100, 100, 0, bottle);
    const before = [...d];
    expect(clearFaintAndMeasure(d, 100, 100)).toEqual({ x: 39, y: 9, w: 22, h: 82 });
    expect([...d]).toEqual(before);
  });

  it("soft edges above the floor are kept (no hard cut into the glass)", () => {
    const d = picture(10, 10, 0);
    d[(5 * 10 + 5) * 4 + 3] = ALPHA_FLOOR + 1;
    expect(clearFaintAndMeasure(d, 10, 10)).toEqual({ x: 4, y: 4, w: 3, h: 3 });
    expect(d[(5 * 10 + 5) * 4 + 3]).toBe(ALPHA_FLOOR + 1);
  });

  it("nothing left: null", () => {
    expect(clearFaintAndMeasure(picture(10, 10, 10), 10, 10)).toBeNull();
  });

  it("an opaque studio background is recognised by its corners; a veil or a centred bottle is not", () => {
    expect(cornersOpaque(picture(100, 100, 255, bottle), 100, 100)).toBe(true);
    expect(cornersOpaque(picture(100, 100, 14, bottle), 100, 100)).toBe(false);
    expect(cornersOpaque(picture(100, 100, 0, bottle), 100, 100)).toBe(false);
    // a bottle filling the picture's height (cut tight) leaves the corners empty
    expect(cornersOpaque(picture(100, 100, 0, { x: 40, y: 0, w: 20, h: 100 }), 100, 100)).toBe(
      false,
    );
  });
});
