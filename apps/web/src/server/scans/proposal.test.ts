import { describe, expect, it, vi } from "vitest";
import type { ScanResult } from "@cellr/domain";

vi.mock("server-only", () => ({}));
const { proposalOf } = await import("./service");

const facts = {
  producer: "Château Témoin",
  name: "Grand Vin",
  year: 2018,
  nonVintage: false,
  type: "red",
  countryCode: "FR",
  region: "Bordeaux",
  appellation: null,
  grapes: [],
  abv: null,
  volumeMl: null,
  confidence: { producer: "high", name: "high", year: "high" },
} as unknown as NonNullable<ScanResult["facts"]>;
const wine = (id: string, catalog: boolean) => ({
  wine: {
    id,
    producer: "P",
    name: "N",
    type: "red" as const,
    countryCode: "FR",
    region: null,
    catalog,
  },
  score: 0.9,
});

describe("what a scan proposed, for catalogue learning", () => {
  it("a single catalogue wine found is a catalogue proposal, with the year read", () => {
    expect(proposalOf("found", [wine("cw", true)], facts)).toEqual({
      kind: "catalog",
      wineId: "cw",
      year: 2018,
    });
  });
  it("nothing matched: the AI's own reading is the proposal", () => {
    expect(proposalOf("new", [], facts)).toEqual({
      kind: "ai",
      year: 2018,
      ai: {
        producer: "Château Témoin",
        name: "Grand Vin",
        type: "red",
        country: "FR",
        region: "Bordeaux",
      },
    });
  });
  it("the household's own wine, or a choice between several, proposes nothing to learn from", () => {
    expect(proposalOf("found", [wine("own", false)], facts)).toBeNull();
    expect(proposalOf("choose", [wine("cw", true), wine("cw2", true)], facts)).toBeNull();
  });
});
