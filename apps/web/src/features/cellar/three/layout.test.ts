import { describe, expect, it } from "vitest";
import {
  BOTTLE_LENGTH,
  cameraDistance,
  capsulePoints,
  GLASS,
  GLASS_CLEAR,
  GLASS_TINT,
  liquidPoints,
  LIQUID,
  FOIL,
  radiusAt,
  STORAGE_LOOK,
  lathePoints,
  layoutFor,
  SHAPES,
  showcasePhases,
  showcaseSpot,
  SLIDE_OUT,
  slotPosition,
  unitSize,
  wrapLines,
} from "./layout";

describe("the bottle profile", () => {
  for (const shape of Object.keys(SHAPES) as Array<keyof typeof SHAPES>) {
    it(`${shape}: starts on the axis at the base, ends on it at the top, rises monotonically`, () => {
      const pts = lathePoints(shape);
      expect(pts[0]).toEqual([0, 0]);
      expect(pts.at(-1)).toEqual([0, BOTTLE_LENGTH]);
      for (let i = 1; i < pts.length; i++)
        expect(pts[i]![1]).toBeGreaterThanOrEqual(pts[i - 1]![1]);
    });
    it(`${shape}: the widest part is the body and the neck is narrower than a third of it`, () => {
      const pts = lathePoints(shape);
      const widest = Math.max(...pts.map(([r]) => r));
      expect(widest).toBeCloseTo(SHAPES[shape].radius, 5);
      expect(SHAPES[shape].neckRadius).toBeLessThan(widest / 3);
    });
  }
  it("a champagne bottle is stouter than a bordeaux", () => {
    expect(SHAPES.champagne.radius).toBeGreaterThan(SHAPES.bordeaux.radius);
  });
});

describe("slot positions", () => {
  it("centres the grid on the origin and runs left→right, top→bottom", () => {
    expect(slotPosition(1, 1, 1, 1)).toEqual([0, 0, 0]);
    const [x1, y1] = slotPosition(1, 1, 3, 4);
    const [x2, y2] = slotPosition(3, 4, 3, 4);
    expect(x1).toBeCloseTo(-x2);
    expect(y1).toBeCloseTo(-y2);
    expect(x1).toBeLessThan(0);
    expect(y1).toBeGreaterThan(0);
    expect(slotPosition(1, 2, 3, 4)[0] - slotPosition(1, 1, 3, 4)[0]).toBe(1);
    expect(slotPosition(1, 1, 3, 4)[1] - slotPosition(2, 1, 3, 4)[1]).toBe(1);
  });
});

describe("framing", () => {
  it("bigger units need the camera further back", () => {
    expect(cameraDistance(10, 10, 1)).toBeGreaterThan(cameraDistance(3, 3, 1));
    expect(unitSize(5, 4).height).toBeGreaterThan(5);
  });
  it("a wide unit on a tall (phone) screen is limited by its width", () => {
    expect(cameraDistance(2, 20, 0.5)).toBeGreaterThan(cameraDistance(2, 20, 2));
  });
});

describe("the showcase movement", () => {
  it("starts in the slot and ends on display, never overshooting", () => {
    expect(showcasePhases(0)).toEqual({ slide: 0, rise: 0, glide: 0 });
    expect(showcasePhases(1)).toEqual({ slide: 1, rise: 1, glide: 1 });
    for (let i = 0; i <= 100; i++) {
      const { slide, rise, glide } = showcasePhases(i / 100);
      for (const v of [slide, rise, glide]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("slides out before it stands up, and keeps moving forward only", () => {
    // Half way through the slide the bottle is still lying down.
    const early = showcasePhases(0.15);
    expect(early.slide).toBeGreaterThan(0.1);
    expect(early.rise).toBe(0);
    // Once it has cleared the rack it rises.
    const later = showcasePhases(0.6);
    expect(later.slide).toBe(1);
    expect(later.rise).toBeGreaterThan(0);
    let previous = showcasePhases(0);
    for (let i = 1; i <= 100; i++) {
      const now = showcasePhases(i / 100);
      expect(now.slide).toBeGreaterThanOrEqual(previous.slide);
      expect(now.rise).toBeGreaterThanOrEqual(previous.rise);
      expect(now.glide).toBeGreaterThanOrEqual(previous.glide);
      previous = now;
    }
  });

  it("clears the front of the rack before it turns", () => {
    expect(SLIDE_OUT).toBeGreaterThan(BOTTLE_LENGTH);
  });

  it("stands left of the details on a wide screen and above them on a phone", () => {
    expect(layoutFor(1280)).toBe("side");
    expect(layoutFor(390)).toBe("top");
    expect(showcaseSpot("side").x).toBeLessThan(0);
    expect(showcaseSpot("top").y).toBeGreaterThan(0);
    for (const l of ["side", "top"] as const) expect(showcaseSpot(l).fill).toBeLessThan(0.8);
  });
});

describe("wrapLines", () => {
  const measure = (s: string) => s.length * 10;
  it("keeps a short name on one line", () => {
    expect(wrapLines("Pavillon Rouge", measure, 200, 3)).toEqual(["Pavillon Rouge"]);
  });
  it("breaks between words, never inside them", () => {
    expect(wrapLines("Chablis Premier Cru Montmains", measure, 170, 3)).toEqual([
      "Chablis Premier",
      "Cru Montmains",
    ]);
  });
  it("says so when it will not fit, so the caller can use smaller type", () => {
    expect(wrapLines("Chablis Premier Cru Montmains Vieilles Vignes", measure, 100, 2)).toBeNull();
    expect(wrapLines("Supercalifragilistic", measure, 100, 3)).toBeNull();
  });
  it("copes with nothing", () => {
    expect(wrapLines("   ", measure, 100, 2)).toEqual([]);
  });
});

describe("what the bottle is made of", () => {
  for (const shape of Object.keys(SHAPES) as Array<keyof typeof SHAPES>) {
    it(`${shape}: the capsule sits just outside the glass, from its start to the top`, () => {
      const cap = capsulePoints(shape);
      expect(cap[0]![1]).toBeCloseTo(SHAPES[shape].capsuleFrom * BOTTLE_LENGTH, 5);
      expect(cap.at(-1)).toEqual([0, BOTTLE_LENGTH + 0.004]);
      for (const [r, y] of cap.slice(0, -1)) expect(r).toBeGreaterThan(radiusAt(shape, y));
    });

    it(`${shape}: the wine stays inside the glass and stops at its fill line`, () => {
      const wine = liquidPoints(shape);
      const top = SHAPES[shape].fill * BOTTLE_LENGTH;
      expect(wine.at(-1)).toEqual([0, top]);
      for (const [r, y] of wine) {
        expect(y).toBeLessThanOrEqual(top + 1e-9);
        expect(r).toBeLessThan(radiusAt(shape, y));
      }
    });

    it(`${shape}: the body is widest at the bottom, the neck narrow`, () => {
      expect(radiusAt(shape, BOTTLE_LENGTH * 0.3)).toBeCloseTo(SHAPES[shape].radius, 5);
      expect(radiusAt(shape, BOTTLE_LENGTH * 0.95)).toBeLessThan(SHAPES[shape].radius / 2);
    });
  }

  it("every wine type has a glass, a tint, a wine colour and a foil; glass lets through 0–1", () => {
    for (const type of Object.keys(GLASS) as Array<keyof typeof GLASS>) {
      for (const table of [GLASS, GLASS_TINT, LIQUID, FOIL])
        expect(table[type]).toMatch(/^#[0-9a-f]{6}$/);
      expect(GLASS_CLEAR[type]).toBeGreaterThan(0);
      expect(GLASS_CLEAR[type]).toBeLessThanOrEqual(1);
    }
  });

  it("every kind of storage has a look, with sensible board thickness", () => {
    for (const kind of ["fridge", "rack", "cabinet", "shelving", "wall", "other"] as const) {
      const look = STORAGE_LOOK[kind];
      expect(look).toBeDefined();
      expect(look.board).toBeGreaterThan(0.3);
      expect(look.board).toBeLessThan(2);
    }
    expect(STORAGE_LOOK.rack.dividers).toBe(true);
    expect(STORAGE_LOOK.fridge.dividers).toBe(false);
    expect(STORAGE_LOOK.fridge.glow).toBe(true);
  });
});
