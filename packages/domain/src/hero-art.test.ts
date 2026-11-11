import { describe, expect, it } from "vitest";
import { heroArtWines, type CellarItem, type DrinkSummary } from "./cellar";
import type { DrinkPhase } from "./drink-window";

const drink = (phase: DrinkPhase, urgency: number, reliable = true): DrinkSummary => ({
  source: reliable ? "ai" : "estimate",
  reliable,
  uncertain: false,
  phase,
  from: 2020,
  until: 2030,
  urgency,
  yearsUntilOpen: null,
  yearsLeft: null,
  position: null,
});
const ART = { id: "a", width: 300, height: 900 };

let n = 0;
/** Newest first, like the cellar: build them in that order. */
const item = (name: string, over: Partial<CellarItem> = {}): CellarItem => ({
  vintageId: `v${++n}`,
  wineId: `w${n}`,
  producer: "Producer",
  wineName: name,
  type: "red",
  year: 2019,
  region: null,
  countryCode: "FR",
  count: 1,
  places: [],
  unplaced: 0,
  image: null,
  favorite: false,
  rating: null,
  drink: drink("developing", 2),
  ...over,
});
const names = (items: CellarItem[]) => items.map((i) => i.wineName);

describe("the bottles in Home's Tonight hero", () => {
  it("only wines with a published 2D picture: a label photo never counts", () => {
    const cellar = [
      item("photo only", { image: { id: "i", width: 10, height: 10 } as never }),
      item("nothing"),
      item("art", { art: ART }),
    ];
    expect(names(heroArtWines(cellar))).toEqual(["art"]);
    expect(heroArtWines([item("photo", { image: { id: "i" } as never })])).toEqual([]);
    expect(heroArtWines([])).toEqual([]);
  });

  it("the ones to open now first (drink soon, then at their best), then the newest, then the rest", () => {
    const old = Array.from({ length: 8 }, (_, i) => item(`filler ${i}`));
    const cellar = [
      item("newest", { art: ART }),
      item("peak", { art: ART, drink: drink("peak", 1.4) }),
      item("past", { art: ART, drink: drink("past", -1) }),
      ...old,
      item("old", { art: ART }),
    ];
    expect(names(heroArtWines(cellar, 4))).toEqual(["past", "peak", "newest", "old"]);
    expect(names(heroArtWines(cellar))).toEqual(["past", "peak"]);
  });

  it("a rough window (the style table) never makes a wine look ready: it waits its turn by date", () => {
    const cellar = [
      item("newer", { art: ART }),
      item("rough peak", { art: ART, drink: drink("peak", 1.4, false) }),
    ];
    expect(names(heroArtWines(cellar))).toEqual(["newer", "rough peak"]);
  });

  it("one bottle with a picture is enough; never more than asked for", () => {
    expect(names(heroArtWines([item("a"), item("only", { art: ART })]))).toEqual(["only"]);
    const many = Array.from({ length: 5 }, (_, i) => item(`w${i}`, { art: ART }));
    expect(heroArtWines(many)).toHaveLength(2);
    expect(heroArtWines(many, 1)).toHaveLength(1);
  });
});
