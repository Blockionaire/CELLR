import { describe, expect, it } from "vitest";
import {
  cellrBucket,
  cellrScoreToStars,
  poolExternal,
  ratingScore,
  starRows,
  CELLR_WEIGHT,
  EXTERNAL_WEIGHT_CAP,
} from "./rating-score";

const ext = (count: number, avgStars: number) => ({
  count,
  sumHalf: Math.round(count * avgStars * 2),
});

describe("cellrScoreToStars", () => {
  it("converts the 1–10 scale to stars (half the score)", () => {
    expect(cellrScoreToStars(10)).toBe(5);
    expect(cellrScoreToStars(1)).toBe(0.5);
    expect(cellrScoreToStars(9)).toBe(4.5);
    expect(cellrScoreToStars(8.4)).toBe(4.2);
  });
  it.each([0, 0.5, 10.2, Number.NaN])("refuses %s", (s) => {
    expect(() => cellrScoreToStars(s)).toThrow();
  });
});

describe("ratingScore", () => {
  it("zero ratings: no score, and says so", () => {
    expect(ratingScore({ count: 0, sumHalf: 0 }, [])).toEqual({
      combined: null,
      external: { count: 0, average: null },
      cellr: { count: 0, average: null },
      weights: { external: 0, cellr: 0 },
    });
  });
  it("one external rating only", () => {
    const r = ratingScore(ext(1, 4), []);
    expect(r.combined).toBe(4);
    expect(r.external).toEqual({ count: 1, average: 4 });
  });
  it("one CELLR review only: its stars", () => {
    const r = ratingScore({ count: 0, sumHalf: 0 }, [7]);
    expect(r.combined).toBe(3.5);
    expect(r.cellr).toEqual({ count: 1, average: 3.5 });
  });
  it("a few of each: the weighted formula", () => {
    // external 4.0 × 10 ratings (weight 10); CELLR 5.0 and 3.0 stars (weight 5 each)
    const r = ratingScore(ext(10, 4), [10, 6]);
    expect(r.combined).toBe(Math.round(((4 * 10 + (5 + 3) * 5) / (10 + 10)) * 10) / 10);
    expect(r.weights).toEqual({ external: 10, cellr: 10 });
  });
  it("thousands of external ratings weigh as 50, while the real count is shown", () => {
    const r = ratingScore(ext(10000, 3), [10]);
    expect(r.external.count).toBe(10000);
    expect(r.weights.external).toBe(EXTERNAL_WEIGHT_CAP);
    expect(r.combined).toBe(Math.round(((3 * 50 + 5 * CELLR_WEIGHT) / 55) * 10) / 10);
  });
  it("ten CELLR reviews weigh as much as any number of external ratings", () => {
    const r = ratingScore(ext(20000, 2), Array(10).fill(10));
    expect(r.combined).toBe(3.5);
    expect(r.cellr.count).toBe(10);
  });
  it("thousands of CELLR reviews: the community leads", () => {
    const r = ratingScore(ext(20000, 2), Array(2000).fill(9));
    expect(r.combined).toBe(4.5);
  });
  it("counts are never weighted", () => {
    const r = ratingScore(ext(3, 4), [8, 8]);
    expect(r.external.count + r.cellr.count).toBe(5);
    expect(r.weights.cellr).toBe(10);
  });
  it("refuses an impossible external sum", () => {
    expect(() => ratingScore({ count: 2, sumHalf: 30 }, [])).toThrow();
    expect(() => ratingScore({ count: 2, sumHalf: 1 }, [])).toThrow();
  });
  it("realistic examples", () => {
    // a well-known wine: 1,200 external ratings at 4.1, 3 CELLR reviews at 4.5, 4.0 and 3.5 stars
    expect(ratingScore(ext(1200, 4.1), [9, 8, 7]).combined).toBe(4.1);
    // a disappointing bottle the community disagrees about: 40 external at 4.3, 6 CELLR at 2.5
    expect(ratingScore(ext(40, 4.3), Array(6).fill(5)).combined).toBe(3.5);
    // a rarity: 2 external at 3.0, 1 CELLR at 4.5
    expect(ratingScore(ext(2, 3), [9]).combined).toBe(4.1);
  });
});

describe("helpers", () => {
  it("pools vintages exactly", () => {
    expect(poolExternal([ext(2, 4), ext(3, 3)])).toEqual({ count: 5, sumHalf: 16 + 18 });
  });
  it("folds half stars into five star rows", () => {
    expect(starRows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([3, 7, 11, 15, 19]);
    expect(() => starRows([1, 2])).toThrow();
  });
  it("puts a CELLR score in its half-star bucket", () => {
    expect(cellrBucket(10)).toBe(9);
    expect(cellrBucket(1)).toBe(0);
    expect(cellrBucket(8.4)).toBe(7);
    expect(cellrBucket(9)).toBe(8);
  });
});
