import { describe, expect, it } from "vitest";
import {
  buildTasteProfile,
  NO_PREFERENCES,
  offerTasteOnboarding,
  SaveTastePreferencesSchema,
  scalesFor,
  tasteSection,
  tasteExampleVintageIds,
  tasteTabs,
  winePoints,
  withExampleAvailability,
  type TasteTasting,
} from "./taste";

let n = 0;
const t = (over: Partial<TasteTasting> = {}): TasteTasting => {
  n += 1;
  return {
    wineId: `w${n}`,
    vintageId: `v${n}`,
    producer: `P${n}`,
    wineName: `W${n}`,
    year: 2018,
    type: "red",
    region: null,
    appellation: null,
    score: null,
    grapes: [],
    structure: null,
    ...over,
  };
};

describe("one point per wine (no double counting)", () => {
  it("three tastings of one wine, across vintages and bottles, are one wine with their mean score", () => {
    const a = t({ wineId: "musar", score: 10, year: 2016 });
    const b = t({ wineId: "musar", score: 6, year: 2018 });
    const c = t({ wineId: "musar", score: null, year: 2018 });
    const [p] = winePoints([a, b, c]);
    expect(p).toMatchObject({ wineId: "musar", tastings: 3, score: 8 });
    // The example shown is its best-scored vintage.
    expect(p!.ref.vintageId).toBe(a.vintageId);
    expect(tasteSection([a, b, c])).toMatchObject({
      tastings: 3,
      winesTasted: 1,
      winesRated: 1,
      average: 4,
    });
  });
});

describe("favourites need enough different wines behind them", () => {
  const rioja = (score: number) => t({ region: "Rioja", score });
  it("one or two great Riojas are not a favourite region; three are", () => {
    expect(tasteSection([rioja(10), rioja(9)]).favouriteRegions).toEqual([]);
    const s = tasteSection([rioja(10), rioja(9), rioja(8)]);
    expect(s.favouriteRegions).toMatchObject([{ key: "Rioja", wines: 3, average: 4.5 }]);
    expect(s.favouriteRegions[0]!.examples.map((e) => e.score)).toEqual([10, 9, 8]);
  });
  it("the same wine tasted three times does not make three wines", () => {
    const same = [1, 2, 3].map(() => t({ wineId: "one", region: "Rioja", score: 10 }));
    expect(tasteSection(same).favouriteRegions).toEqual([]);
  });
  it("often tasted is not the same as rated highly", () => {
    const s = tasteSection([
      t({ region: "Bordeaux", score: 4 }),
      t({ region: "Bordeaux", score: 5 }),
      t({ region: "Bordeaux", score: 4 }),
    ]);
    expect(s.favouriteRegions).toEqual([]);
    expect(s.mostTastedRegions).toEqual([{ key: "Bordeaux", wines: 3 }]);
  });
  it("no grapes known: no grape favourites, and the profile says how many wines have grapes", () => {
    const s = tasteSection([t({ score: 10 }), t({ score: 10 }), t({ score: 10 })]);
    expect(s).toMatchObject({ favouriteGrapes: [], grapesKnown: 0 });
    const g = tasteSection([1, 2, 3].map(() => t({ score: 9, grapes: ["Nebbiolo"] })));
    expect(g.favouriteGrapes).toMatchObject([{ key: "Nebbiolo", wines: 3 }]);
  });
  it("missing regions are left out, never guessed", () => {
    const s = tasteSection([1, 2, 3].map(() => t({ score: 10, region: null })));
    expect(s.favouriteRegions).toEqual([]);
  });
});

describe("trends on the scales", () => {
  const liked = (body: number) =>
    t({ score: 9, structure: { body, tannin: 4, sweetness: 1, acidity: 3 } });
  it("need three highly rated wines with a reliable structure", () => {
    expect(tasteSection([liked(4), liked(5)]).trends.body).toBeNull();
    expect(tasteSection([liked(4), liked(5), liked(3)]).trends.body).toEqual({
      value: 4,
      wines: 3,
    });
  });
  it("wines rated below 4 stars, or without structure, do not count", () => {
    const meh = t({ score: 6, structure: { body: 1 } });
    const none = t({ score: 10, structure: null });
    expect(tasteSection([liked(4), liked(4), meh, none]).trends.body).toBeNull();
  });
});

describe("the whole profile", () => {
  it("an empty profile: nothing invented, onboarding offered", () => {
    const v = buildTasteProfile([], NO_PREFERENCES);
    expect(v.distribution).toEqual([]);
    expect(v.overview).toMatchObject({
      tastings: 0,
      average: null,
      favouriteRegions: [],
      favouriteStyles: [],
    });
    expect(Object.values(v.overview.trends).every((x) => x === null)).toBe(true);
    expect(offerTasteOnboarding(v)).toBe(true);
    expect(
      offerTasteOnboarding({ ...v, preferences: { ...NO_PREFERENCES, onboarded: true } }),
    ).toBe(false);
  });
  it("an established profile: distribution by kind, per-kind sections, styles in the overview", () => {
    const reds = [10, 9, 8].map((score) => t({ type: "red", score, region: "Rioja" }));
    const whites = [6, 7].map((score) => t({ type: "white", score }));
    const fort = t({ type: "fortified", score: 8 });
    const v = buildTasteProfile([...reds, ...whites, fort], NO_PREFERENCES);
    expect(v.distribution.map((d) => [d.type, d.wines])).toEqual([
      ["red", 3],
      ["white", 2],
      ["fortified", 1],
    ]);
    // One rated fortified wine is too few for a per-kind average.
    expect(v.distribution.find((d) => d.type === "fortified")!.average).toBeNull();
    expect(v.byType.red!.favouriteRegions[0]!.key).toBe("Rioja");
    expect(v.byType.white!.favouriteRegions).toEqual([]);
    expect(v.overview.favouriteStyles.map((f) => f.key)).toEqual(["red"]);
    expect(tasteTabs(v)).toEqual(["red", "white", "rose", "sparkling", "fortified"]);
    expect(offerTasteOnboarding(v)).toBe(false);
  });
  it("a kind's tab only holds that kind; tannin is not a white wine's scale", () => {
    const whites = [1, 2, 3].map(() =>
      t({ type: "white", score: 9, structure: { body: 2, tannin: 3, acidity: 4 } }),
    );
    const v = buildTasteProfile([...whites, t({ type: "red", score: 2 })], NO_PREFERENCES);
    expect(v.byType.white).toMatchObject({ winesTasted: 3, average: 4.5 });
    expect(v.byType.white!.trends.tannin).toBeNull();
    expect(v.byType.white!.trends.acidity).toEqual({ value: 4, wines: 3 });
  });
});

describe("my own answers", () => {
  it("every answer is optional and on the 1–5 scales", () => {
    expect(
      SaveTastePreferencesSchema.parse({
        wineFocus: null,
        body: null,
        tannin: 5,
        sweetness: null,
        acidity: 1,
      }),
    ).toMatchObject({ tannin: 5, acidity: 1 });
    expect(() =>
      SaveTastePreferencesSchema.parse({
        wineFocus: "blue",
        body: null,
        tannin: null,
        sweetness: null,
        acidity: null,
      }),
    ).toThrow();
    expect(() =>
      SaveTastePreferencesSchema.parse({
        wineFocus: null,
        body: 6,
        tannin: null,
        sweetness: null,
        acidity: null,
      }),
    ).toThrow();
  });
  it("tannin is not asked of someone who mostly drinks white or rosé", () => {
    expect(scalesFor("white_rose")).toEqual(["body", "sweetness", "acidity"]);
    expect(scalesFor("red")).toEqual(["body", "tannin", "sweetness", "acidity"]);
  });
  it("a kind's average needs two rated wines; the overall average does not", () => {
    const one = buildTasteProfile([t({ type: "white", score: 8 })], NO_PREFERENCES);
    expect(one.byType.white).toMatchObject({ winesRated: 1, average: null });
    expect(one.distribution[0]!.average).toBeNull();
    expect(one.overview.average).toBe(4);
    const two = buildTasteProfile(
      [t({ type: "white", score: 8 }), t({ type: "white", score: 6 })],
      NO_PREFERENCES,
    );
    expect(two.byType.white).toMatchObject({ winesRated: 2, average: 3.5 });
    expect(two.distribution[0]!.average).toBe(3.5);
  });
});

describe("example wines and whether their pages open", () => {
  it("not linkable until known; then only the household's available vintages", () => {
    const rioja = [10, 9, 8].map((score) => t({ region: "Rioja", score }));
    const v = buildTasteProfile(rioja, NO_PREFERENCES);
    const ids = tasteExampleVintageIds(v);
    expect(ids.sort()).toEqual(rioja.map((r) => r.vintageId).sort());
    expect(v.overview.favouriteRegions[0]!.examples.every((e) => !e.available)).toBe(true);
    withExampleAvailability(v, new Set([rioja[1]!.vintageId, rioja[2]!.vintageId]));
    for (const section of [v.overview, v.byType.red!])
      expect(section.favouriteRegions[0]!.examples.map((e) => [e.vintageId, e.available])).toEqual([
        [rioja[0]!.vintageId, false],
        [rioja[1]!.vintageId, true],
        [rioja[2]!.vintageId, true],
      ]);
  });
});
