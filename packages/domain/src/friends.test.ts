import { describe, expect, it } from "vitest";
import { HandleSchema, tasteHeadline, type FriendTaste } from "./friends";

describe("an account name", () => {
  it("is tidied: no @, lowercase", () => {
    expect(HandleSchema.parse(" @Wine.Lover_1 ")).toBe("wine.lover_1");
  });
  it("is 3–20 plain characters", () => {
    for (const bad of ["ab", "a b c", "_start", "x".repeat(21), "two..dots", "émile"])
      expect(HandleSchema.safeParse(bad).success).toBe(false);
  });
});

describe("a taste profile in a few words", () => {
  const base: FriendTaste = {
    tastings: 10,
    average: 4,
    byType: [
      { type: "red", count: 7, average: 4.2 },
      { type: "white", count: 3, average: 3.5 },
    ],
    regions: [],
    words: [],
    structure: { body: 4.2, tannin: 3.8, sweetness: 1.2, acidity: 3 },
    favourites: [],
  };
  it("names what they drink most and how they like it", () => {
    expect(tasteHeadline(base)).toEqual({
      favouriteType: "red",
      leanings: ["full", "firm", "dry"],
    });
  });
  it("says nothing it does not know", () => {
    expect(tasteHeadline({ ...base, byType: [], structure: null })).toEqual({
      favouriteType: null,
      leanings: [],
    });
  });
});
