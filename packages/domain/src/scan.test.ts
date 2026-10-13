import { describe, expect, it } from "vitest";
import type { WineSummary } from "./cellar";
import {
  matchLabel,
  nameSimilarity,
  normalizeExtraction,
  suggestWine,
  type LabelFacts,
  type RawExtraction,
} from "./scan";

const NOW = new Date("2026-10-12T12:00:00Z");
const raw = (over: Partial<RawExtraction> = {}): RawExtraction => ({
  is_wine_label: true,
  producer: "Château Margaux",
  wine_name: "Pavillon Rouge",
  vintage: 2015,
  non_vintage: false,
  wine_type: "red",
  country_code: "FR",
  region: "Bordeaux",
  appellation: "Margaux",
  grapes: ["Cabernet Sauvignon", "Merlot"],
  abv_percent: 13.5,
  volume_ml: 750,
  text_seen: "CHÂTEAU MARGAUX PAVILLON ROUGE 2015",
  label_corners: null,
  confidence: { producer: "high", wine_name: "high", vintage: "high" },
  ...over,
});
const facts = (over: Partial<LabelFacts> = {}): LabelFacts => ({
  ...normalizeExtraction(raw(), NOW)!,
  ...over,
});
const wine = (
  id: string,
  producer: string,
  name: string,
  over: Partial<WineSummary> = {},
): WineSummary => ({
  id,
  producer,
  name,
  type: "red",
  countryCode: "FR",
  region: "Bordeaux",
  ...over,
});

describe("what the model says is checked before it is believed", () => {
  it("keeps what is plausible, tidied", () => {
    const result = normalizeExtraction(
      raw({
        producer: "  Château\u0000  Margaux \n",
        wine_name: "Pavillon   Rouge",
        grapes: [" Merlot ", ""],
      }),
      NOW,
    );
    expect(result).toMatchObject({
      producer: "Château Margaux",
      name: "Pavillon Rouge",
      year: 2015,
      type: "red",
      countryCode: "FR",
      grapes: ["Merlot"],
      abv: 13.5,
      volumeMl: 750,
    });
  });

  it("drops a vintage no wine could have, and says it is unsure", () => {
    for (const vintage of [2087, 1066, 1999.5, 0]) {
      const result = normalizeExtraction(raw({ vintage }), NOW)!;
      expect(result.year).toBeNull();
      expect(result.confidence.year).toBe("low");
    }
    expect(normalizeExtraction(raw({ vintage: 2027 }), NOW)!.year).toBe(2027); // next year's wine can be on sale
    expect(normalizeExtraction(raw({ vintage: 2028 }), NOW)!.year).toBeNull();
    expect(normalizeExtraction(raw({ vintage: 1800 }), NOW)!.year).toBe(1800);
  });

  it("a printed year beats 'non-vintage'; without a year, non-vintage stands", () => {
    expect(normalizeExtraction(raw({ non_vintage: true }), NOW)).toMatchObject({
      year: 2015,
      nonVintage: false,
    });
    expect(normalizeExtraction(raw({ vintage: null, non_vintage: true }), NOW)).toMatchObject({
      year: null,
      nonVintage: true,
    });
    expect(normalizeExtraction(raw({ vintage: null, non_vintage: false }), NOW)).toMatchObject({
      year: null,
      nonVintage: false,
    });
  });

  it("only accepts kinds of wine, countries and strengths that exist", () => {
    expect(normalizeExtraction(raw({ wine_type: "Sparkling" }), NOW)!.type).toBe("sparkling");
    expect(normalizeExtraction(raw({ wine_type: "vin rouge" }), NOW)!.type).toBeNull();
    expect(normalizeExtraction(raw({ wine_type: null }), NOW)!.type).toBeNull();
    expect(normalizeExtraction(raw({ country_code: "fr" }), NOW)!.countryCode).toBe("FR");
    const atlantis = normalizeExtraction(raw({ country_code: "XX" }), NOW)!;
    expect(atlantis.countryCode).toBeNull();
    expect(atlantis.confidence.producer).toBe("medium"); // a wrong country makes the rest less certain
    expect(normalizeExtraction(raw({ abv_percent: 45 }), NOW)!.abv).toBeNull();
    expect(normalizeExtraction(raw({ abv_percent: 4 }), NOW)!.abv).toBeNull();
    expect(normalizeExtraction(raw({ volume_ml: 7 }), NOW)!.volumeMl).toBeNull();
    expect(normalizeExtraction(raw({ volume_ml: 1500 }), NOW)!.volumeMl).toBe(1500);
  });

  it("limits what can be stored: lengths and the number of grapes", () => {
    const result = normalizeExtraction(
      raw({
        producer: "x".repeat(500),
        grapes: Array.from({ length: 12 }, (_, i) => `Grape ${i}`),
      }),
      NOW,
    )!;
    expect(result.producer!.length).toBe(120);
    expect(result.grapes).toHaveLength(6);
  });

  it("says nothing when it was not a label, or nothing could be read", () => {
    expect(normalizeExtraction(raw({ is_wine_label: false }), NOW)).toBeNull();
    expect(normalizeExtraction(raw({ producer: null, wine_name: null }), NOW)).toBeNull();
    expect(normalizeExtraction(raw({ producer: "  ", wine_name: "\u0001" }), NOW)).toBeNull();
    // One of the two is enough to start from.
    expect(normalizeExtraction(raw({ producer: null }), NOW)).not.toBeNull();
  });

  it("starts a new wine from the best name the label gives", () => {
    expect(suggestWine(facts())).toMatchObject({
      producer: "Château Margaux",
      name: "Pavillon Rouge",
      type: "red",
      region: "Bordeaux",
    });
    expect(suggestWine(facts({ name: null }))).toMatchObject({ name: "Margaux" }); // the appellation stands in
    expect(suggestWine(facts({ name: null, appellation: null, region: null }))).toMatchObject({
      name: "Château Margaux",
    });
    expect(suggestWine(facts({ producer: null }))).toMatchObject({ producer: "Pavillon Rouge" });
    expect(suggestWine(facts({ type: null })).type).toBeNull(); // not guessed: the person chooses
  });
});

describe("names that mean the same estate", () => {
  it("ignore accents, case, and words that only say what kind of estate it is", () => {
    expect(nameSimilarity("Château Margaux", "CHATEAU MARGAUX")).toBe(1);
    expect(nameSimilarity("Château Margaux", "Margaux")).toBeGreaterThan(0.95);
    expect(nameSimilarity("Domaine de la Romanée-Conti", "Romanée Conti")).toBeGreaterThan(0.9);
    expect(nameSimilarity("Weingut Dr. Loosen", "Dr Loosen")).toBeGreaterThan(0.9);
  });
  it("forgive a slipped letter and a different order, but not a different name", () => {
    expect(nameSimilarity("Tignanello", "Tignannello")).toBeGreaterThan(0.85);
    expect(nameSimilarity("Special Cuvée Brut", "Brut Special Cuvée")).toBeGreaterThan(0.9);
    expect(nameSimilarity("Château Margaux", "Château Latour")).toBeLessThan(0.5);
    expect(nameSimilarity("", "Margaux")).toBe(0);
    expect(nameSimilarity("Château", "Château")).toBe(1); // only estate words: they are all there is
  });
});

describe("is it one of the wines you already have?", () => {
  const cellar = [
    wine("1", "Château Margaux", "Pavillon Rouge"),
    wine("2", "Château Margaux", "Pavillon Blanc", { type: "white" }),
    wine("3", "Château Latour", "Les Forts de Latour"),
    wine("4", "Antinori", "Tignanello", { countryCode: "IT", region: "Tuscany" }),
  ];

  it("recognises the same wine written differently, and is sure", () => {
    const result = matchLabel(
      facts({ producer: "CHATEAU MARGAUX", name: "Pavillon Rouge" }),
      cellar,
    );
    expect(result.outcome).toBe("found");
    expect(result.matches.map((m) => m.wine.id)).toEqual(["1"]);
    expect(result.matches[0]!.score).toBeGreaterThan(0.9);
  });

  it("offers the candidates when the estate is right but the wine is unclear", () => {
    const result = matchLabel(
      facts({ name: null, appellation: null, region: null, type: null }),
      cellar,
    );
    expect(result.outcome).toBe("choose");
    expect(result.matches.map((m) => m.wine.id).sort()).toEqual(["1", "2"]);
    expect(result.matches[0]!.score).toBeGreaterThanOrEqual(result.matches[1]!.score);
  });

  it("a red and a white of one estate are different wines", () => {
    const result = matchLabel(facts({ name: "Pavillon Blanc", type: "white" }), cellar);
    expect(result.matches[0]!.wine.id).toBe("2");
    expect(result.outcome).toBe("found");
  });

  it("says 'new' for something you do not have, even with a similar word in it", () => {
    const result = matchLabel(
      facts({
        producer: "Bodegas Muga",
        name: "Reserva",
        type: "red",
        countryCode: "ES",
        region: "Rioja",
        appellation: "Rioja",
      }),
      cellar,
    );
    expect(result).toEqual({ outcome: "new", matches: [] });
    expect(matchLabel(facts(), [])).toEqual({ outcome: "new", matches: [] });
  });

  it("does not claim a match across countries", () => {
    const same = matchLabel(
      facts({ producer: "Antinori", name: "Tignanello", countryCode: "IT", region: "Tuscany" }),
      cellar,
    );
    expect(same.outcome).toBe("found");
    const other = matchLabel(
      facts({ producer: "Antinori", name: "Tignanello", countryCode: "US", region: "Napa" }),
      cellar,
    );
    expect(other.outcome).not.toBe("found");
  });

  it("never offers more than three, best first, in a steady order", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      wine(`m${i}`, "Château Margaux", `Cuvée ${i}`),
    );
    const result = matchLabel(
      facts({ name: null, appellation: null, region: null, type: null }),
      many,
    );
    expect(result.matches).toHaveLength(3);
    expect(result.matches.map((m) => m.wine.id)).toEqual(["m0", "m1", "m2"]);
  });

  it("with no name on the label, one estate alone is not 'found' unless the place agrees too", () => {
    const lone = [wine("1", "Château Margaux", "Pavillon Rouge")];
    const bare = facts({
      name: null,
      appellation: null,
      region: null,
      type: null,
      countryCode: null,
    });
    expect(matchLabel(bare, lone).outcome).toBe("choose");
  });
});
