import { describe, expect, it } from "vitest";
import type { WineSummary } from "./cellar";
import { matchLabel, type LabelFacts } from "./scan";
import { matchLabelSafely, resolveWine } from "./wine-resolver";

const facts = (over: Partial<LabelFacts> = {}): LabelFacts => ({
  producer: "Bodega Ejemplo",
  name: "Tinto Fino",
  year: 2019,
  nonVintage: false,
  type: "red",
  countryCode: "ES",
  region: "Rioja",
  appellation: null,
  grapes: [],
  abv: null,
  volumeMl: 750,
  confidence: { producer: "high", name: "high", year: "high" },
  ...over,
});
const own = (over: Partial<WineSummary> = {}): WineSummary => ({
  id: "own-1",
  producer: "Bodega Ejemplo",
  name: "Tinto Fino",
  type: "red",
  countryCode: "ES",
  region: "Rioja",
  ...over,
});

describe("the household's own wine is 'found' only when nothing read contradicts it (review of Sprint 004C)", () => {
  it("exactly the wine, or written differently: found, as before", () => {
    expect(matchLabelSafely(facts(), [own()]).outcome).toBe("found");
    expect(
      matchLabelSafely(facts({ producer: "BODEGA EJEMPLO", name: "tinto fino" }), [own()]).outcome,
    ).toBe("found");
    expect(resolveWine(facts(), [own()]).status).toBe("exact_candidate");
  });

  it("a Reserva or Gran Reserva label of the plain wine: a choice, never found", () => {
    for (const name of ["Tinto Fino Reserva", "Tinto Fino Gran Reserva"]) {
      // what the score alone decided before
      expect(matchLabel(facts({ name }), [own()]).outcome).toBe("found");
      const safe = matchLabelSafely(facts({ name }), [own()]);
      expect(safe.outcome).toBe("choose");
      expect(safe.matches.map((m) => m.wine.id)).toEqual(["own-1"]);
      const resolved = resolveWine(facts({ name }), [own()]);
      expect(resolved.status).toBe("ambiguous");
      expect(resolved.candidates[0]!.reasons).toContain("other_bottling");
    }
  });

  it("the white or rosé of the household's red: a choice, never found", () => {
    for (const type of ["white", "rose"] as const) {
      expect(matchLabel(facts({ type }), [own()]).outcome).toBe("found");
      expect(matchLabelSafely(facts({ type }), [own()]).outcome).toBe("choose");
      expect(resolveWine(facts({ type }), [own()]).candidates[0]!.reasons).toContain(
        "type_differs",
      );
    }
  });

  it("a colour that was not read is no contradiction", () => {
    expect(matchLabelSafely(facts({ type: null }), [own()]).outcome).toBe("found");
  });

  it("a catalogue wine keeps its own rule: found only on an exact identity", () => {
    const cat = own({ id: "cat-1", catalog: true });
    expect(matchLabelSafely(facts(), [cat]).outcome).toBe("found");
    expect(matchLabelSafely(facts({ name: "Tinto Fino Reserva" }), [cat]).outcome).not.toBe(
      "found",
    );
  });

  it("nothing close: new, as before", () => {
    expect(
      matchLabelSafely(facts({ producer: "Otra Casa", name: "Blanco Lejano" }), [own()]),
    ).toEqual({ outcome: "new", matches: [] });
  });
});
