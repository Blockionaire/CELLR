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
import { rankForTonight, type TonightCandidate } from "./tonight";

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

describe("a small taste nudge in the plain Tonight ranking", () => {
  it("is capped and needs evidence", () => {
    expect(tasteBonus({ type: "red", region: "Rioja" }, riojaLover)).toBe(MAX_TASTE_BONUS);
    expect(tasteBonus({ type: "white", region: "Mosel" }, riojaLover)).toBe(0);
    expect(tasteBonus({ type: "red", region: "Rioja" }, null)).toBe(0);
  });

  it("decides between two otherwise equal wines, and says so", () => {
    const a = wine({ wineName: "Bordeaux red", region: "Bordeaux" });
    const b = wine({ wineName: "Rioja red", region: "Rioja" });
    const general = rankForTonight([a, b], { dish: null, occasion: "anything" }, NOW);
    expect(general[0]!.candidate.wineName).toBe("Bordeaux red"); // alphabetical, without taste
    const mine = rankForTonight([a, b], { dish: null, occasion: "anything" }, NOW, riojaLover);
    expect(mine[0]!.candidate.wineName).toBe("Rioja red");
    expect(mine[0]!.reasons).toContain("your-taste");
  });

  it("never lifts a poor pairing over a good one", () => {
    const sauvignon = wine({ wineName: "Sancerre", type: "white", region: "Loire" });
    const rioja = wine({ wineName: "Rioja", type: "red", region: "Rioja" });
    const picks = rankForTonight(
      [sauvignon, rioja],
      { dish: "shellfish", occasion: "anything" },
      NOW,
      riojaLover,
    );
    expect(picks[0]!.candidate.wineName).toBe("Sancerre");
    expect(picks.find((p) => p.candidate.wineName === "Rioja")!.reasons).not.toContain(
      "your-taste",
    );
  });

  it("never outweighs a wine that is clearly readier, nor 'use it up'", () => {
    const ready = wine({ wineName: "Ready Bordeaux", region: "Bordeaux", drink: drink("ready") });
    const developing = wine({ wineName: "Rioja", region: "Rioja", drink: drink("developing") });
    expect(
      rankForTonight([ready, developing], { dish: null, occasion: "anything" }, NOW, riojaLover)[0]!
        .candidate.wineName,
    ).toBe("Ready Bordeaux");
    const useUp = rankForTonight(
      [wine({ region: "Rioja" })],
      { dish: null, occasion: "use-it-up" },
      NOW,
      riojaLover,
    );
    expect(useUp[0]!.reasons).not.toContain("your-taste");
  });
});
