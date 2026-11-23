import { describe, expect, it } from "vitest";
import { bottlesFor, enoughFor, GATHERINGS } from "./quantity";

describe("bottles for a number of people", () => {
  it("one person still needs a bottle, and two share one", () => {
    expect(bottlesFor(1)).toEqual({ guests: 1, bottles: 1, perWine: [1] });
    expect(bottlesFor(2)).toEqual({ guests: 2, bottles: 1, perWine: [1] });
  });

  it("rounds up, never down: nobody's glass stays empty", () => {
    expect(bottlesFor(3).bottles).toBe(2);
    expect(bottlesFor(9).bottles).toBe(5);
    expect(bottlesFor(7, { gathering: "reception" }).bottles).toBe(3);
  });

  it("is bounded: at most 500 people and 8 wines, at least one of each", () => {
    expect(bottlesFor(500).bottles).toBe(250);
    expect(bottlesFor(5000).guests).toBe(500);
    expect(bottlesFor(0).guests).toBe(1);
    expect(bottlesFor(-3).bottles).toBe(1);
    expect(bottlesFor(10, { wines: 20 }).perWine).toHaveLength(8);
    expect(bottlesFor(10, { wines: 0 }).perWine).toHaveLength(1);
  });

  it("each gathering asks more or less per person, in that order", () => {
    const [dinner, reception, long] = GATHERINGS.map(
      (g) => bottlesFor(40, { gathering: g }).bottles,
    );
    expect(reception!).toBeLessThan(dinner!);
    expect(long!).toBeGreaterThan(dinner!);
  });

  it("a menu's total is at least the single-wine total (each course is rounded up)", () => {
    for (const guests of [1, 2, 5, 8, 13, 60])
      for (const wines of [1, 2, 3, 5, 8])
        expect(bottlesFor(guests, { wines }).bottles).toBeGreaterThanOrEqual(
          bottlesFor(guests).bottles,
        );
  });

  it("enough and short never go negative", () => {
    expect(enoughFor(0, 0)).toEqual({ enough: true, short: 0 });
    expect(enoughFor(3, 10)).toEqual({ enough: true, short: 0 });
    expect(enoughFor(3, 0)).toEqual({ enough: false, short: 3 });
  });
});
