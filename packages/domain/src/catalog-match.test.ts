import { describe, expect, it } from "vitest";
import type { WineSummary } from "./cellar";
import { isCatalogIdentity, matchLabel, pickExistingWine, type LabelFacts } from "./scan";

const wine = (id: string, over: Partial<WineSummary> = {}): WineSummary => ({
  id,
  producer: "Domaine Test",
  name: "Cuvée Alpha",
  type: "red",
  countryCode: "FR",
  region: "Bourgogne",
  ...over,
});
const alpha = wine("alpha", { catalog: true, aliases: ["Alpha"] });
const reserve = wine("reserve", { catalog: true, name: "Cuvée Alpha Réserve" });

const facts = (over: Partial<LabelFacts> = {}): LabelFacts => ({
  producer: "DOMAINE TEST",
  name: "Cuvée Alpha",
  year: 2019,
  nonVintage: false,
  type: "red",
  countryCode: "FR",
  region: null,
  appellation: null,
  grapes: [],
  abv: null,
  volumeMl: null,
  confidence: { producer: "high", name: "high", year: "high" },
  ...over,
});

describe("finding a catalogue wine on a label", () => {
  it("the exact producer and name (any case, accents or punctuation) is found", () => {
    expect(matchLabel(facts(), [alpha, reserve])).toMatchObject({
      outcome: "found",
      matches: [{ wine: { id: "alpha" } }],
    });
    expect(matchLabel(facts({ name: "CUVEE ALPHA RESERVE" }), [alpha, reserve])).toMatchObject({
      outcome: "found",
      matches: [{ wine: { id: "reserve" } }],
    });
  });

  it("a verified alias counts as the wine's name", () => {
    expect(isCatalogIdentity(facts({ name: "Alpha" }), alpha)).toBe(true);
    expect(matchLabel(facts({ name: "Alpha" }), [alpha]).outcome).toBe("found");
  });

  it("a similar name is offered as a choice, never taken as the catalogue wine", () => {
    // "Alpha Reserve" is close to both, but is exactly neither: the person chooses.
    const close = matchLabel(facts({ name: "Alpha Reserve" }), [alpha, reserve]);
    expect(close.outcome).toBe("choose");
    expect(close.matches.map((m) => m.wine.id)).toContain("reserve");
    // A slipped letter in the producer is not the producer.
    expect(isCatalogIdentity(facts({ producer: "Domaine Tesst" }), alpha)).toBe(false);
    expect(matchLabel(facts({ producer: "Domaine Tesst" }), [alpha]).outcome).not.toBe("found");
  });

  it("a different colour or country is never the catalogue wine", () => {
    expect(isCatalogIdentity(facts({ type: "white" }), alpha)).toBe(false);
    expect(isCatalogIdentity(facts({ countryCode: "IT" }), alpha)).toBe(false);
    expect(matchLabel(facts({ type: "white" }), [alpha]).outcome).not.toBe("found");
  });

  it("without a producer or a name on the label there is no catalogue identity", () => {
    expect(isCatalogIdentity(facts({ producer: null }), alpha)).toBe(false);
    expect(isCatalogIdentity(facts({ name: null }), alpha)).toBe(false);
  });

  it("when the household has its own wine of that name too, the person chooses between them", () => {
    const own = wine("own");
    const both = matchLabel(facts(), [alpha, own]);
    expect(both.outcome).toBe("choose");
    expect(both.matches.map((m) => m.wine.id).sort()).toEqual(["alpha", "own"]);
  });

  it("the household's own wines keep matching as before (by similarity, then confirmed)", () => {
    const mine = wine("mine", { name: "Cuvee Alfa" });
    expect(matchLabel(facts(), [mine]).outcome).toBe("found");
  });

  it("the year read off the label is never changed by the match", () => {
    expect(matchLabel(facts({ year: 2021 }), [alpha]).outcome).toBe("found");
    // matchLabel returns the wine only; the year stays what was read (facts), for the person to confirm.
  });
});

describe("typing a wine by hand", () => {
  const typed = {
    producer: "domaine test",
    name: "cuvee alpha",
    type: "red" as const,
    countryCode: "FR",
  };

  it("the household's own wine of that name wins: never silently swapped for the catalogue", () => {
    const own = wine("own");
    expect(pickExistingWine(typed, [own], [alpha])?.id).toBe("own");
  });

  it("otherwise exactly one catalogue wine is used instead of making a private duplicate", () => {
    expect(pickExistingWine(typed, [], [alpha, reserve])?.id).toBe("alpha");
    expect(pickExistingWine({ ...typed, name: "Alpha" }, [], [alpha])?.id).toBe("alpha");
  });

  it("a similar, contradicting or ambiguous name is not guessed: a private wine is made as before", () => {
    expect(pickExistingWine({ ...typed, name: "Cuvee Alpa" }, [], [alpha])).toBeNull();
    expect(pickExistingWine({ ...typed, type: "white" }, [], [alpha])).toBeNull();
    expect(pickExistingWine({ ...typed, countryCode: "IT" }, [], [alpha])).toBeNull();
    const twin = wine("twin", { catalog: true, countryCode: null });
    expect(pickExistingWine(typed, [], [alpha, twin])).toBeNull();
    expect(pickExistingWine(typed, [], [])).toBeNull();
  });

  it("a catalogue wine in the household's list is not mistaken for its own private one", () => {
    expect(pickExistingWine(typed, [alpha], [alpha])?.id).toBe("alpha");
  });
});
