import { describe, expect, it } from "vitest";
import type { WineSummary } from "./cellar";
import type { LabelFacts } from "./scan";
import { draftOrigins, existingWineOrigins, sameName, vintageOrigin } from "./scan-provenance";

const facts = (over: Partial<LabelFacts> = {}): LabelFacts => ({
  producer: "CHATEAU MARGAUX",
  name: "Pavillon Rouge",
  year: 2015,
  nonVintage: false,
  type: "red",
  countryCode: "FR",
  region: "Bordeaux",
  appellation: "Margaux",
  grapes: [],
  abv: null,
  volumeMl: 750,
  confidence: { producer: "high", name: "high", year: "high" },
  ...over,
});
const wine = (over: Partial<WineSummary> = {}): WineSummary => ({
  id: "w1",
  producer: "Château Margaux",
  name: "Pavillon Rouge",
  type: "red",
  countryCode: "FR",
  region: "Bordeaux",
  ...over,
});

describe("sameName", () => {
  it("folds accents and case, and accepts one name inside the other", () => {
    expect(sameName("CHATEAU MARGAUX", "Château Margaux")).toBe(true);
    expect(sameName("Margaux", "Château Margaux")).toBe(true);
  });
  it("allows the producer's name and little words around a name, nothing else", () => {
    expect(
      sameName("Pavillon Rouge du Château Margaux", "Pavillon Rouge", ["Château Margaux"]),
    ).toBe(true);
    expect(sameName("Le Grand Vin de Château Conflit", "Grand Vin", ["Château Conflit"])).toBe(
      true,
    );
    expect(sameName("Grand Vin Blanc", "Grand Vin", ["Château Conflit"])).toBe(false);
    expect(sameName("Cuvée Alpha Réserve", "Cuvée Alpha")).toBe(false);
  });
  it("tells cuvées of one producer apart", () => {
    expect(sameName("Pavillon Blanc", "Pavillon Rouge")).toBe(false);
    expect(sameName("Cuvée Alpha", "Cuvée Beta")).toBe(false);
    expect(sameName("", "Pavillon Rouge")).toBe(false);
  });
});

describe("an existing wine: its record, confirmed by the label where the label agrees", () => {
  it("an exact catalogue match read off the label: every field the label agrees with says so", () => {
    expect(existingWineOrigins(wine({ catalog: true }), facts())).toEqual({
      producer: { source: "label" },
      name: { source: "label" },
      type: { source: "label" },
      countryCode: { source: "label" },
      region: { source: "label" },
    });
  });

  it("what the label did not say comes from the catalogue (verified), never as if read", () => {
    const o = existingWineOrigins(
      wine({ catalog: true }),
      facts({ countryCode: null, region: null, appellation: null, type: null }),
    );
    expect(o.type).toEqual({ source: "catalog" });
    expect(o.countryCode).toEqual({ source: "catalog" });
    expect(o.region).toEqual({ source: "catalog" });
  });

  it("the household's own wine is named as theirs, not as CELLR's", () => {
    expect(existingWineOrigins(wine(), facts({ region: null, appellation: null })).region).toEqual({
      source: "cellar",
    });
  });

  it("a field the record does not have stays unknown", () => {
    const o = existingWineOrigins(wine({ countryCode: null, region: null }), facts());
    expect(o.countryCode).toEqual({ source: "unknown" });
    expect(o.region).toEqual({ source: "unknown" });
  });

  it("another cuvée or colour on the label is a conflict, even where the matcher found the wine", () => {
    const o = existingWineOrigins(wine(), facts({ name: "Pavillon Rouge Réserve", type: "white" }));
    expect(o.name).toEqual({ source: "cellar", conflict: "Pavillon Rouge Réserve" });
    expect(o.type).toEqual({ source: "cellar", conflict: "white" });
  });

  it("a label that disagrees is shown beside the record, never applied", () => {
    const o = existingWineOrigins(
      wine({ catalog: true }),
      facts({ name: "Pavillon Blanc", type: "white", countryCode: "IT" }),
    );
    expect(o.name).toEqual({ source: "catalog", conflict: "Pavillon Blanc" });
    expect(o.type).toEqual({ source: "catalog", conflict: "white" });
    expect(o.countryCode).toEqual({ source: "catalog", conflict: "IT" });
  });

  it("an alias of a catalogue wine is the same name", () => {
    const o = existingWineOrigins(
      wine({ catalog: true, aliases: ["Pavillon Rouge du Château Margaux"] }),
      facts({ name: "Le Pavillon Rouge du Chateau Margaux" }),
    );
    expect(o.name.source).toBe("label");
  });

  it("a region said at another level (the appellation) is agreement, a different one no conflict", () => {
    expect(existingWineOrigins(wine({ region: "Margaux" }), facts()).region).toEqual({
      source: "label",
    });
    expect(
      existingWineOrigins(wine({ region: "Haut-Médoc" }), facts({ appellation: null })).region,
    ).toEqual({ source: "cellar" });
  });

  it("a remembered photo read nothing: nothing is said to be from the label", () => {
    const o = existingWineOrigins(wine(), facts(), { remembered: true });
    expect(Object.values(o).every((f) => f.source === "cellar")).toBe(true);
  });

  it("a catalogue wine named by the label's printed text: its name was on the label", () => {
    const o = existingWineOrigins(wine({ catalog: true }), null, { fromText: true });
    expect(o.producer).toEqual({ source: "label" });
    expect(o.name).toEqual({ source: "label" });
    expect(o.type).toEqual({ source: "catalog" });
  });
});

describe("a new wine's fields", () => {
  const start = {
    producer: "Bollinger",
    name: "Special Cuvée",
    type: null,
    countryCode: "FR",
    region: "",
  };
  it("say what they were started from, until changed; empty is unknown", () => {
    expect(draftOrigins(start, start, "label")).toEqual({
      producer: { source: "label" },
      name: { source: "label" },
      type: { source: "unknown" },
      countryCode: { source: "label" },
      region: { source: "unknown" },
    });
    const changed = draftOrigins(
      { ...start, name: "Grande Année", type: "sparkling" },
      start,
      "label",
    );
    expect(changed.name).toEqual({ source: "typed" });
    expect(changed.type).toEqual({ source: "typed" });
  });
  it("from an external record: a suggestion to check, never verified", () => {
    expect(draftOrigins(start, start, "record").producer).toEqual({ source: "record" });
  });
  it("nothing read: everything typed or unknown", () => {
    const empty = { producer: "", name: "", type: "red" as const, countryCode: "", region: "" };
    expect(draftOrigins({ ...empty, producer: "X" }, empty, "none").producer).toEqual({
      source: "typed",
    });
  });
});

describe("the vintage", () => {
  it("comes from the label, flagged when it was hard to read", () => {
    expect(vintageOrigin(facts())).toEqual({ source: "label", check: false });
    expect(
      vintageOrigin(facts({ confidence: { producer: "high", name: "high", year: "low" } })),
    ).toEqual({ source: "label", check: true });
    expect(vintageOrigin(facts({ year: null, nonVintage: true }))).toEqual({
      source: "label",
      check: false,
    });
  });
  it("from an earlier confirmation of this photo, said as such", () => {
    expect(vintageOrigin(facts(), { remembered: true }).source).toBe("remembered");
  });
  it("is unknown when not read: never taken from the vintages a wine has", () => {
    expect(vintageOrigin(facts({ year: null }))).toEqual({ source: "unknown", check: false });
    expect(vintageOrigin(null)).toEqual({ source: "unknown", check: false });
  });
});
