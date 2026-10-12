import { describe, expect, it } from "vitest";
import {
  BOTTLE_LENGTH,
  cameraDistance,
  lathePoints,
  SHAPES,
  slotPosition,
  unitSize,
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
