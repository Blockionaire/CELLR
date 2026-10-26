import { describe, expect, it } from "vitest";
import type { WineSummary } from "./cellar";
import { confirmedFacts, matchLabel, recallScan } from "./scan";

const wine = (id: string, over: Partial<WineSummary> = {}): WineSummary => ({
  id,
  producer: "Château Margaux",
  name: "Pavillon Rouge",
  type: "red",
  countryCode: "FR",
  region: "Bordeaux",
  ...over,
});

describe("remembered scans", () => {
  const wines = [wine("w1"), wine("w2", { name: "Pavillon Blanc", type: "white" })];

  it("one agreeing confirmation of a wine the household still has is recalled", () => {
    expect(recallScan([{ wineId: "w1", year: 2015 }], wines)).toEqual({
      wine: wines[0],
      year: 2015,
    });
  });

  it("nothing, disagreement, or a wine that is gone is not trusted", () => {
    expect(recallScan([], wines)).toBeNull();
    expect(
      recallScan(
        [
          { wineId: "w1", year: 2015 },
          { wineId: "w1", year: 2016 },
        ],
        wines,
      ),
    ).toBeNull();
    expect(recallScan([{ wineId: "gone", year: 2015 }], wines)).toBeNull();
  });

  it("the facts are the confirmed wine and year, sure enough to match that wine and only it", () => {
    const facts = confirmedFacts(wines[0]!, null);
    expect(facts).toMatchObject({
      producer: "Château Margaux",
      name: "Pavillon Rouge",
      year: null,
      nonVintage: true,
      type: "red",
      grapes: [],
      confidence: { producer: "high", name: "high", year: "high" },
    });
    // Matching the household's wines again (as the scan screen does) still lands on the confirmed one.
    expect(matchLabel(facts, wines)).toMatchObject({
      outcome: "found",
      matches: [{ wine: { id: "w1" } }],
    });
  });
});
