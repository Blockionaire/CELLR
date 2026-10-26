import { describe, expect, it } from "vitest";
import {
  checkInsight,
  profileLanguage,
  reusableInsight,
  shareableInsight,
  type RawInsight,
} from "./insights";

const raw: RawInsight = {
  summary: "Pavillon Rouge, the second wine of Château Margaux.",
  style: "Elegant red",
  grapes: ["Cabernet Sauvignon", "Merlot"],
  tasting: "Cassis and violet.",
  serving_temp_min_c: 16,
  serving_temp_max_c: 18,
  decant_minutes: 60,
  abv_percent: 13.5,
  pairings: ["Lamb"],
  aging: "Ten years.",
  body: 4,
  tannin: 4,
  sweetness: 1,
  acidity: 3,
  flavors: [{ group: "black_fruit", notes: ["Cassis"] }],
  pairing_kinds: ["lamb"],
  drink_from_year: 2024,
  drink_until_year: 2040,
  country_code: "FR",
  region: "Bordeaux",
  appellation: "Margaux",
  confidence: "high",
  evidence: "exact_wine",
  sources: [{ name: "Château Margaux", url: "https://www.chateau-margaux.com/pavillon-rouge" }],
};
const consulted = ["https://www.chateau-margaux.com/pavillon-rouge"];
const wine = { year: 2019, countryCode: "FR" };
const checked = (over: Partial<RawInsight> = {}, researched = true, sources = consulted) =>
  checkInsight({ ...raw, ...over }, 2019, sources, researched)!;

describe("which profiles other households may reuse", () => {
  it("a researched, sourced, sure profile of this exact wine qualifies", () => {
    expect(shareableInsight(checked(), wine, "FR")).toBe(true);
  });

  it("not researched, only about the producer, unsure, or without a verified source: stays private", () => {
    expect(shareableInsight(checked({}, false, []), wine)).toBe(false);
    expect(shareableInsight(checked({ evidence: "producer" }), wine)).toBe(false);
    expect(shareableInsight(checked({ evidence: "style_estimate" }), wine)).toBe(false);
    expect(shareableInsight(checked({ confidence: "medium" }), wine)).toBe(false);
    // "exact wine" without a page the search really consulted is downgraded by checkInsight, so never shared.
    expect(shareableInsight(checked({}, true, ["https://elsewhere.example/"]), wine)).toBe(false);
  });

  it("a profile that contradicts the wine (another country, a window before the harvest) is not shared", () => {
    expect(shareableInsight(checked(), wine, "IT")).toBe(false);
    const early = { ...checked(), drinkWindow: { from: 2015, until: 2030 } };
    expect(shareableInsight(early, wine)).toBe(false);
    // A window cannot belong to a non-vintage wine.
    expect(shareableInsight(checked(), { year: null, countryCode: "FR" })).toBe(false);
  });

  it("a profile carrying a price is never shared", () => {
    const priced = {
      ...checked(),
      value: { lowCents: 3000, highCents: 4000, currency: "EUR", basis: "I paid this" },
    };
    expect(shareableInsight(priced, wine)).toBe(false);
  });

  it("what comes back from the database is checked again: an older version or broken data is not used", () => {
    expect(reusableInsight(checked(), wine)).toMatchObject({ evidence: "exact_wine" });
    expect(reusableInsight({ ...checked(), version: 5 }, wine)).toBeNull();
    expect(reusableInsight({ summary: 42 }, wine)).toBeNull();
    expect(reusableInsight(null, wine)).toBeNull();
  });

  it("the language follows the person's own", () => {
    expect(profileLanguage("nl")).toBe("nl");
    expect(profileLanguage("en")).toBe("en");
    expect(profileLanguage("de")).toBe("en");
  });
});
