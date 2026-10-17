import { describe, expect, it } from "vitest";
import type { DrinkSummary } from "./cellar";
import type { DrinkPhase } from "./drink-window";
import { OCCASIONS, rankForTonight, TonightRequestSchema, type TonightCandidate } from "./tonight";

const NOW = new Date("2026-10-12T12:00:00Z");
const URGENCY: Record<DrinkPhase, number> = {
  past: -1,
  ready: 0.3,
  peak: 1.4,
  developing: 2,
  young: 4,
  unknown: 999,
};
const drink = (phase: DrinkPhase): DrinkSummary => ({
  source: "estimate",
  phase,
  from: 2020,
  until: 2030,
  urgency: URGENCY[phase],
  yearsUntilOpen: null,
  yearsLeft: null,
  position: null,
});

let n = 0;
const wine = (over: Partial<TonightCandidate>): TonightCandidate => ({
  vintageId: `v${++n}`,
  wineId: `w${n}`,
  producer: "Producer",
  wineName: `Wine ${n}`,
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

const cellar = [
  wine({ wineName: "Claret", type: "red", region: "Bordeaux" }),
  wine({ wineName: "Chablis", type: "white", region: "Chablis", year: 2019 }),
  wine({ wineName: "Brut", type: "sparkling", region: "Champagne", pricePerBottleCents: 6000 }),
  wine({
    wineName: "Beaujolais",
    type: "red",
    region: "Beaujolais",
    pricePerBottleCents: 1200,
    year: 2022,
  }),
  wine({
    wineName: "Barolo",
    type: "red",
    region: "Barolo",
    countryCode: "IT",
    pricePerBottleCents: 9000,
    year: 2010,
  }),
  wine({
    wineName: "Baby Claret",
    type: "red",
    region: "Bordeaux",
    drink: drink("young"),
    year: 2025,
  }),
];
const rank = (
  dish: string | null,
  occasion: (typeof OCCASIONS)[number] = "anything",
  list = cellar,
) => rankForTonight(list, TonightRequestSchema.parse({ dish, occasion }), NOW);
const names = (picks: ReturnType<typeof rank>) => picks.map((p) => p.candidate.wineName);

describe("what to drink tonight", () => {
  it("suggests the best match first, an alternative of another colour, and a special choice", () => {
    const picks = rank("steak");
    expect(picks.map((p) => p.slot)).toEqual(["best", "alternative", "special"]);
    expect(["Claret", "Barolo"]).toContain(picks[0]!.candidate.wineName);
    expect(picks[1]!.candidate.type).not.toBe(picks[0]!.candidate.type);
    expect(new Set(picks.map((p) => p.candidate.vintageId)).size).toBe(picks.length);
  });

  it("follows the food: shellfish gets white or bubbles, steak gets red", () => {
    expect(["Chablis", "Brut"]).toContain(rank("shellfish")[0]!.candidate.wineName);
    expect(rank("steak")[0]!.candidate.type).toBe("red");
  });

  it("leaves out wine that is not ready, unless nothing else is", () => {
    expect(names(rank("steak"))).not.toContain("Baby Claret");
    const onlyYoung = [wine({ drink: drink("young"), wineName: "Too young" })];
    expect(names(rank("steak", "anything", onlyYoung))).toEqual(["Too young"]);
  });

  it("a celebration reaches for bubbles or something dear; a weeknight for something easy", () => {
    expect(rank(null, "celebration")[0]!.candidate.wineName).toBe("Brut");
    const weeknight = rank(null, "weeknight")[0]!;
    expect(weeknight.candidate.wineName).toBe("Beaujolais");
    expect(weeknight.reasons).toContain("easy");
  });

  it("'use it up' puts what is running out of time first", () => {
    const list = [
      wine({ wineName: "Fine for years", drink: drink("developing") }),
      wine({ wineName: "Running out", drink: drink("past"), year: 2005 }),
    ];
    const first = rank(null, "use-it-up", list)[0]!;
    expect(first.candidate.wineName).toBe("Running out");
    expect(first.reasons).toContain("use-soon");
  });

  it("favourites and well-rated wines get a nudge, and badly rated ones a push back", () => {
    const list = [
      wine({ wineName: "Plain" }),
      wine({ wineName: "Loved", favorite: true, rating: { average: 4.5, count: 2 } }),
      wine({ wineName: "Disliked", rating: { average: 1.5, count: 1 } }),
    ];
    const picks = rank(null, "anything", list);
    expect(picks[0]!.candidate.wineName).toBe("Loved");
    expect(picks[0]!.reasons).toEqual(expect.arrayContaining(["favorite", "loved"]));
    expect(names(picks).indexOf("Disliked")).toBeGreaterThan(names(picks).indexOf("Plain"));
  });

  it("explains each pick with at most three reasons, and calls a peak wine what it is", () => {
    for (const p of rank("lamb")) expect(p.reasons.length).toBeLessThanOrEqual(3);
    expect(rank("steak")[0]!.reasons).toContain("at-its-best");
  });

  it("says how good the match is in words, not false precision", () => {
    expect(["great", "good", "worth-a-try"]).toContain(rank("steak")[0]!.match);
    expect(rank("shellfish", "anything", [wine({ type: "red" })])[0]!.match).toBe("worth-a-try");
  });

  it("copes with a tiny or empty cellar", () => {
    expect(rank("steak", "anything", [])).toEqual([]);
    const one = rank("steak", "anything", [wine({ wineName: "Only" })]);
    expect(one.map((p) => p.slot)).toEqual(["best"]);
  });
});

describe("the request", () => {
  it("defaults to no dish and no occasion, and refuses a dish that is not on the list", () => {
    expect(TonightRequestSchema.parse({})).toEqual({ dish: null, occasion: "anything" });
    expect(TonightRequestSchema.safeParse({ dish: "steak", occasion: "guests" }).success).toBe(
      true,
    );
    expect(TonightRequestSchema.safeParse({ dish: "moon cheese" }).success).toBe(false);
    expect(TonightRequestSchema.safeParse({ occasion: "wedding" }).success).toBe(false);
  });
});
