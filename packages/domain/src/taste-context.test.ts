import { describe, expect, it } from "vitest";
import type { DrinkSummary } from "./cellar";
import type { DrinkPhase } from "./drink-window";
import {
  buildTasteProfile,
  NO_PREFERENCES,
  type TastePreferences,
  type TasteTasting,
} from "./taste";
import {
  MAX_TASTE_BONUS,
  tasteBonus,
  tasteContextFrom,
  tasteContextText,
  wantsSomethingDifferent,
} from "./taste-context";
import { dishById, scorePairing } from "./pairing";
import { rankForTonight, rankWithTaste, type TonightCandidate } from "./tonight";

let n = 0;
const tasted = (over: Partial<TasteTasting> = {}): TasteTasting => {
  n += 1;
  return {
    wineId: `w${n}`,
    vintageId: `v${n}`,
    producer: `P${n}`,
    wineName: `W${n}`,
    year: 2016,
    type: "red",
    region: null,
    appellation: null,
    score: null,
    grapes: [],
    structure: null,
    ...over,
  };
};
const profile = (tastings: TasteTasting[], prefs: Partial<TastePreferences> = {}) =>
  buildTasteProfile(tastings, { ...NO_PREFERENCES, ...prefs });

describe("the sommelier's view of your taste", () => {
  it("nothing said and nothing rated: no taste, so the sommelier stays the general one", () => {
    expect(tasteContextFrom(profile([]))).toBeNull();
    expect(tasteContextFrom(null)).toBeNull();
  });

  it("what was said is kept apart from what ratings show", () => {
    const ctx = tasteContextFrom(profile([], { wineFocus: "red", body: 4, tannin: 2 }))!;
    expect(ctx.said).toEqual({ focus: "red", scales: { body: 4, tannin: 2 } });
    expect(ctx.rated).toMatchObject({ wines: 0, styles: [], regions: [], grapes: [], trends: {} });
    const text = tasteContextText(ctx);
    expect(text).toContain("Said themselves: mostly red, body 4/5, tannin 2/5.");
    expect(text).toContain("From their ratings (0 wines rated): no clear pattern yet.");
  });

  it("strong ratings become patterns, with the number of wines behind them", () => {
    const rioja = [10, 9, 8].map((score) =>
      tasted({
        region: "Rioja",
        score,
        grapes: ["Tempranillo"],
        structure: { body: 4, tannin: 4, sweetness: 1, acidity: 3 },
      }),
    );
    const ctx = tasteContextFrom(profile(rioja))!;
    expect(ctx.rated.regions).toEqual([{ key: "Rioja", wines: 3, average: 4.5 }]);
    expect(ctx.rated.grapes[0]).toMatchObject({ key: "Tempranillo", wines: 3 });
    expect(ctx.rated.styles[0]).toMatchObject({ key: "red", wines: 3 });
    expect(ctx.rated.trends).toMatchObject({ body: 4, tannin: 4 });
    const text = tasteContextText(ctx);
    expect(text).toContain("regions Rioja (3 wines, 4.5★)");
    expect(text).toContain("liked wines lean body 4/5");
    // Short and predictable: well under the prompt budget.
    expect(text.length).toBeLessThan(500);
  });

  it("too little history is not a pattern: two great wines, or many tasted but not rated, say nothing", () => {
    const two = [10, 10].map((score) => tasted({ region: "Barolo", score }));
    const often = Array.from({ length: 6 }, () => tasted({ region: "Chianti", score: null }));
    expect(tasteContextFrom(profile([...two, ...often]))).toBeNull();
  });

  it("asking for something different is noticed in English and Dutch", () => {
    expect(wantsSomethingDifferent("Surprise me with something new")).toBe(true);
    expect(wantsSomethingDifferent("Ik wil eens iets anders proberen")).toBe(true);
    expect(wantsSomethingDifferent("What goes with steak?")).toBe(false);
    const ctx = tasteContextFrom(profile([], { wineFocus: "red" }))!;
    expect(tasteContextText(ctx, { explore: true })).toContain("something different");
  });
});

const drink = (phase: DrinkPhase): DrinkSummary => ({
  source: "estimate",
  reliable: false,
  uncertain: false,
  phase,
  from: 2020,
  until: 2030,
  urgency: phase === "past" ? -1 : 1,
  yearsUntilOpen: null,
  yearsLeft: null,
  position: null,
});
let c = 0;
const wine = (over: Partial<TonightCandidate>): TonightCandidate => ({
  vintageId: `c${++c}`,
  wineId: `cw${c}`,
  producer: "Producer",
  wineName: `Wine ${c}`,
  type: "red",
  year: 2015,
  region: "Bordeaux",
  countryCode: "FR",
  favorite: false,
  rating: null,
  drink: drink("peak"),
  pricePerBottleCents: 3000,
  ...over,
});
const NOW = new Date("2026-10-12T12:00:00Z");
const riojaLover = tasteContextFrom(
  profile([10, 9, 9].map((score) => tasted({ region: "Rioja", score }))),
)!;

const lover = (region: string) =>
  tasteContextFrom(profile([10, 9, 9].map((score) => tasted({ region, score }))))!;
const bordeauxLover = lover("Bordeaux");
const anything = { dish: null, occasion: "anything" } as const;
const ids = (picks: ReturnType<typeof rankForTonight>) => picks.map((p) => p.candidate.wineName);

describe("taste in the plain Tonight ranking: only ever a tie-breaker", () => {
  it("the bonus is capped and needs evidence", () => {
    expect(tasteBonus({ type: "red", region: "Rioja" }, riojaLover)).toBe(MAX_TASTE_BONUS);
    expect(tasteBonus({ type: "white", region: "Mosel" }, riojaLover)).toBe(0);
    expect(tasteBonus({ type: "red", region: "Rioja" }, null)).toBe(0);
  });

  it("two equally suitable wines: taste decides their order, and that is called personal", () => {
    const a = wine({ wineName: "Bordeaux red", region: "Bordeaux" });
    const b = wine({ wineName: "Rioja red", region: "Rioja" });
    expect(ids(rankForTonight([a, b], anything, NOW))).toEqual(["Bordeaux red", "Rioja red"]);
    const mine = rankWithTaste([a, b], anything, NOW, riojaLover);
    expect(ids(mine.picks)).toEqual(["Rioja red", "Bordeaux red"]);
    expect(mine.personal).toBe(true);
  });

  it("a single wine matching the taste is still the only choice: not called personal", () => {
    const only = rankWithTaste([wine({ region: "Rioja" })], anything, NOW, riojaLover);
    expect(only.picks).toHaveLength(1);
    expect(only.personal).toBe(false);
  });

  it("taste agreeing with the general order changes nothing: not called personal", () => {
    const a = wine({ wineName: "A Rioja", region: "Rioja" });
    const b = wine({ wineName: "B Bordeaux", region: "Bordeaux" });
    const ranked = rankWithTaste([a, b], anything, NOW, riojaLover);
    expect(ids(ranked.picks)).toEqual(["A Rioja", "B Bordeaux"]);
    expect(ranked.personal).toBe(false);
  });

  it("no taste (or personal advice off): exactly the baseline ranking, never personal", () => {
    const cellar = [
      wine({ wineName: "Rioja", region: "Rioja" }),
      wine({ wineName: "Chablis", type: "white", region: "Chablis" }),
      wine({ wineName: "Brut", type: "sparkling", region: "Champagne" }),
    ];
    const baseline = rankForTonight(cellar, anything, NOW);
    const off = rankWithTaste(cellar, anything, NOW, null);
    expect(off.picks).toEqual(baseline);
    expect(off.personal).toBe(false);
  });

  it("equal totals but a worse pairing (55 + favourite against 59): taste cannot move it ahead", () => {
    const quiche = { dish: "quiche", occasion: "anything" } as const;
    const mosel = wine({ wineName: "A Mosel Pinot", region: "Mosel", countryCode: null });
    const bordeaux = wine({
      wineName: "B Bordeaux",
      region: "Bordeaux",
      countryCode: null,
      favorite: true,
    });
    const dish = dishById("quiche")!;
    expect(scorePairing(bordeaux, dish).score).toBe(55);
    expect(scorePairing(mosel, dish).score).toBe(59);
    // The favourite bonus (+4) makes up the difference: the totals tie.
    const baseline = rankForTonight([mosel, bordeaux], quiche, NOW);
    expect(baseline[0]!.total).toBe(baseline[1]!.total);
    expect(ids(baseline)).toEqual(["A Mosel Pinot", "B Bordeaux"]);
    const ranked = rankWithTaste([mosel, bordeaux], quiche, NOW, bordeauxLover);
    expect(ranked.picks).toEqual(baseline);
    expect(ranked.personal).toBe(false);
  });

  it("equal totals but different drinking phases: taste never reorders them", () => {
    const ready = wine({ wineName: "A Ready Bordeaux", region: "Bordeaux", drink: drink("ready") });
    // Developing (+5) with a high rating (+9) ties a ready wine (+14).
    const developing = wine({
      wineName: "B Rioja",
      region: "Rioja",
      drink: drink("developing"),
      rating: { average: 4.8, count: 2 },
    });
    const baseline = rankForTonight([ready, developing], anything, NOW);
    expect(baseline[0]!.total).toBe(baseline[1]!.total);
    expect(ids(baseline)).toEqual(["A Ready Bordeaux", "B Rioja"]);
    const ranked = rankWithTaste([ready, developing], anything, NOW, riojaLover);
    expect(ranked.picks).toEqual(baseline);
    expect(ranked.personal).toBe(false);
  });

  it("among several tied wines only the equivalent ones move, each keeping the others' places", () => {
    // Three reds with equal totals: two at their peak, one "ready" (another phase, so not equivalent).
    const a = wine({ wineName: "A Claret", region: "Bordeaux" });
    const b = wine({ wineName: "B Ready", region: "Loire", drink: drink("ready") });
    const c = wine({ wineName: "C Rioja", region: "Rioja" });
    const baseline = rankForTonight([a, b, c], anything, NOW);
    expect(ids(baseline)).toEqual(["A Claret", "B Ready", "C Rioja"]);
    const ranked = rankWithTaste([a, b, c], anything, NOW, riojaLover);
    // A and C (same total, no dish, same phase) swap; B (ready, not peak) keeps its place.
    expect(ids(ranked.picks)).toEqual(["C Rioja", "B Ready", "A Claret"]);
    expect(ranked.personal).toBe(true);
  });

  it("a nearby better pairing (59 against 55) is never overtaken because of taste", () => {
    const quiche = { dish: "quiche", occasion: "anything" } as const;
    const bordeaux = wine({ wineName: "Bordeaux", region: "Bordeaux", countryCode: null });
    const mosel = wine({ wineName: "Mosel Pinot", region: "Mosel", countryCode: null });
    const dish = dishById("quiche")!;
    expect(scorePairing(bordeaux, dish).score).toBe(55);
    expect(scorePairing(mosel, dish).score).toBe(59);
    const ranked = rankWithTaste([bordeaux, mosel], quiche, NOW, bordeauxLover);
    expect(ids(ranked.picks)[0]).toBe("Mosel Pinot");
    expect(ranked.personal).toBe(false);
  });

  it("a poor pairing gets no taste boost, even when it would only break a tie", () => {
    const shellfish = { dish: "shellfish", occasion: "anything" } as const;
    const a = wine({ wineName: "A Claret", region: "Bordeaux" });
    const b = wine({ wineName: "B Rioja", region: "Rioja" });
    expect(scorePairing(b, dishById("shellfish")!).score).toBeLessThan(55);
    const ranked = rankWithTaste([a, b], shellfish, NOW, riojaLover);
    expect(ranked.picks).toEqual(rankForTonight([a, b], shellfish, NOW));
    expect(ranked.personal).toBe(false);
  });

  it("never outweighs a clearly readier wine, and 'use it up' stays unpersonalised", () => {
    const ready = wine({ wineName: "Ready Bordeaux", region: "Bordeaux", drink: drink("ready") });
    const developing = wine({ wineName: "Rioja", region: "Rioja", drink: drink("developing") });
    expect(ids(rankForTonight([ready, developing], anything, NOW, riojaLover))[0]).toBe(
      "Ready Bordeaux",
    );
    const useUp = { dish: null, occasion: "use-it-up" } as const;
    const a = wine({ wineName: "A Bordeaux", region: "Bordeaux" });
    const b = wine({ wineName: "B Rioja", region: "Rioja" });
    const ranked = rankWithTaste([a, b], useUp, NOW, riojaLover);
    expect(ranked.picks).toEqual(rankForTonight([a, b], useUp, NOW));
    expect(ranked.personal).toBe(false);
  });
});
