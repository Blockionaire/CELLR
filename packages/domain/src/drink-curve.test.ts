import { describe, expect, it } from "vitest";
import { chartYears, drinkQuality, windowStretches, yearFraction } from "./drink-curve";

describe("the drinking curve", () => {
  const q = (t: number) => drinkQuality(t, 2020, 2030);

  it("stays between nothing and perfect", () => {
    for (let t = 2005; t <= 2050; t += 0.25) {
      expect(q(t)).toBeGreaterThanOrEqual(0.1);
      expect(q(t)).toBeLessThanOrEqual(1);
    }
  });
  it("climbs while young and opening up, holds at its best, then eases and fades", () => {
    expect(q(2015)).toBeLessThan(q(2018));
    expect(q(2018)).toBeLessThan(q(2020));
    expect(q(2020)).toBeLessThan(q(2022));
    const peak = Math.max(...Array.from({ length: 41 }, (_, i) => q(2020 + i / 4)));
    expect(peak).toBeCloseTo(1, 2);
    expect(q(2024.75)).toBeCloseTo(1, 1); // the middle of the best stretch
    expect(q(2028)).toBeLessThan(q(2025));
    expect(q(2030)).toBeLessThan(q(2028));
    expect(q(2035)).toBeLessThan(q(2030));
  });
  it("has no jumps where the stretches meet", () => {
    for (const edge of [2020, 2022.5, 2027, 2030]) {
      expect(Math.abs(q(edge - 1e-6) - q(edge + 1e-6))).toBeLessThan(1e-3);
    }
    expect(Math.abs(q(2010 - 1e-6) - q(2010 + 1e-6))).toBeLessThan(1e-3);
  });
  it("copes with a one-year window", () => {
    expect(drinkQuality(2025, 2025, 2025)).toBeGreaterThan(0.5);
  });
});

describe("the years a chart covers", () => {
  it("starts at the harvest (or just before the window) and runs on well past it", () => {
    expect(chartYears(2018, 2023, 2033)).toEqual({ start: 2018, end: 2041 });
    expect(chartYears(null, 2023, 2033).start).toBe(2021);
    expect(chartYears(2025, 2023, 2033).start).toBe(2022); // a window that opens before the vintage still shows its edge
  });
});

describe("the stretches of the window", () => {
  it("are the opening up, the best, and the ready", () => {
    expect(windowStretches(2020, 2030)).toEqual({
      opening: [2020, 2022.5],
      best: [2022.5, 2027],
      ready: [2027, 2030],
    });
  });
});

describe("a date on the year axis", () => {
  it("is the year plus how far through it", () => {
    expect(yearFraction("2026-01-01")).toBeCloseTo(2026, 5);
    expect(yearFraction("2026-07-02")).toBeCloseTo(2026.5, 1);
    expect(yearFraction("2026-12-31T23:00:00Z")).toBeLessThan(2027);
  });
});
