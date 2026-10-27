import { describe, expect, it } from "vitest";
import { formatStars, SaveTastingSchema, scoreOfStars, starsOf, summarizeScores } from "./tasting";

describe("saving a tasting", () => {
  const parse = (input: unknown) => SaveTastingSchema.safeParse(input);

  it("accepts stars alone, words alone or a note alone", () => {
    expect(parse({ score: 9 }).success).toBe(true);
    expect(parse({ descriptors: ["fruity"] }).success).toBe(true);
    expect(parse({ note: "With the lamb." }).success).toBe(true);
  });
  it("needs to say something", () => {
    expect(parse({}).success).toBe(false);
    expect(parse({ score: null, descriptors: [], note: "   " }).success).toBe(false);
  });
  it("keeps stars between half a star and five", () => {
    for (const score of [1, 5, 10]) expect(parse({ score }).success).toBe(true);
    for (const score of [0, 11, 4.5, -1, "9"]) expect(parse({ score }).success).toBe(false);
  });
  it("knows only its own words, each once, at most twelve", () => {
    expect(parse({ descriptors: ["fruity", "nonsense"] }).success).toBe(false);
    expect(parse({ descriptors: ["fruity", "fruity", "bold"] }).data?.descriptors).toEqual([
      "fruity",
      "bold",
    ]);
  });
  it("trims the note and turns blank into nothing", () => {
    expect(parse({ score: 6, note: "  lovely  " }).data?.note).toBe("lovely");
    expect(parse({ score: 6, note: "   " }).data?.note).toBeNull();
    expect(parse({ score: 6, note: "x".repeat(2001) }).success).toBe(false);
  });
  it("takes tenths of a star (4.2 = 8.4), exactly, and nothing finer", () => {
    expect(parse({ score: 8.4 }).data?.score).toBe(8.4);
    expect(parse({ score: 4.2 * 2 }).data?.score).toBe(8.4); // 8.4000000001 → 8.4
    expect(parse({ score: 2 }).data?.score).toBe(2); // 1.0 star
    for (const score of [8.5, 8.3, 9.99]) expect(parse({ score }).success).toBe(false);
  });
  it("fills in what was left out", () => {
    expect(parse({ score: 8 }).data).toEqual({ score: 8, descriptors: [], note: null });
  });
});

describe("stars", () => {
  it("round-trips tenths of a star without floating-point tails", () => {
    for (let tenths = 10; tenths <= 50; tenths++) {
      const stars = tenths / 10;
      expect(starsOf(scoreOfStars(stars))).toBe(stars);
    }
    expect(formatStars(8.4)).toBe("4.2");
    expect(scoreOfStars(4.2)).toBe(8.4);
  });
  it("shows half stars without trailing zeros", () => {
    expect([1, 2, 9, 10].map(formatStars)).toEqual(["0.5", "1", "4.5", "5"]);
    expect(starsOf(7)).toBe(3.5);
  });
  it("averages in stars, one decimal, and says how many people rated", () => {
    expect(summarizeScores([9, 8])).toEqual({ average: 4.3, count: 2 });
    expect(summarizeScores([10])).toEqual({ average: 5, count: 1 });
    expect(summarizeScores([1, 10, 6])).toEqual({ average: 2.8, count: 3 });
  });
  it("has no average for nothing", () => {
    expect(summarizeScores([])).toBeNull();
  });
});
