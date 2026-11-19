import { describe, expect, it } from "vitest";
import { groupTasteScore, hasTaste, NO_TASTE, tasteScore, type TasteSignals } from "./taste";
import type { WineStructure } from "./wine";

const wine = (type: "red" | "white", s: Partial<WineStructure>, keys: string[] = []) => ({
  type,
  keys: [type, ...keys],
  structure: {
    body: 3,
    tannin: 3,
    acidity: 3.5,
    sweetness: 0.5,
    intensity: 3,
    oak: 1,
    alcohol: 2,
    fizz: false,
    ...s,
  },
});
const pauillac = wine("red", { body: 4.5, tannin: 4.5 }, ["bordeaux", "cabernet sauvignon"]);
const muscadet = wine("white", { body: 1, tannin: 0, acidity: 5 }, ["muscadet", "loire"]);

describe("taste as a score", () => {
  it("is zero when nothing is known", () => {
    expect(tasteScore(pauillac, null)).toBe(0);
    expect(tasteScore(pauillac, NO_TASTE)).toBe(0);
    expect(hasTaste(NO_TASTE)).toBe(false);
  });
  it("rises for what the ratings favour and what was said", () => {
    const bordeauxLover: TasteSignals = {
      ...NO_TASTE,
      styles: ["red"],
      likes: ["Bordeaux"],
      focus: "red",
    };
    expect(tasteScore(pauillac, bordeauxLover)).toBeGreaterThan(0.7);
    expect(tasteScore(muscadet, bordeauxLover)).toBeLessThan(0);
  });
  it("follows the stated scales, more than the trends", () => {
    const light: TasteSignals = { ...NO_TASTE, said: { body: 1, tannin: 1 } };
    expect(tasteScore(muscadet, light)).toBeGreaterThan(0.2);
    expect(tasteScore(pauillac, light)).toBeLessThan(-0.2);
    const mixed: TasteSignals = { ...NO_TASTE, said: { body: 1 }, trends: { body: 5 } };
    expect(tasteScore(muscadet, mixed)).toBeGreaterThan(tasteScore(pauillac, mixed));
  });
  it("stays between -1 and 1, whatever it is given", () => {
    const all: TasteSignals = {
      focus: "red",
      styles: ["red"],
      likes: ["bordeaux"],
      said: { body: 5, tannin: 5 },
      trends: { body: 5 },
    };
    expect(tasteScore(pauillac, all)).toBeLessThanOrEqual(1);
    expect(tasteScore(muscadet, all)).toBeGreaterThanOrEqual(-1);
    const odd = { ...NO_TASTE, said: { body: Number.NaN, tannin: 1e9 } } as TasteSignals;
    const score = tasteScore(pauillac, odd);
    expect(Number.isFinite(score)).toBe(true);
    expect(Math.abs(score)).toBeLessThanOrEqual(1);
  });
});

describe("a table of several people", () => {
  it("is pulled toward whoever likes the wine least", () => {
    expect(groupTasteScore([])).toBe(0);
    expect(groupTasteScore([0.6])).toBe(0.6);
    expect(groupTasteScore([1, 1, -1])).toBeLessThan(0);
    expect(groupTasteScore([0.4, 0.4, 0.4])).toBe(0.4);
    expect(groupTasteScore([0.3, 0.3, 0.3])).toBeGreaterThan(groupTasteScore([1, 1, -0.8]));
  });
});
