import { describe, expect, it } from "vitest";
import {
  PROFILE_VERSION,
  SommelierPlanSchema,
  type CellarItem,
  type InsightOutput,
} from "@cellr/domain";
import { createSommelierIntelligence } from "./intelligence";

/** The premium experiences: each is the same engines and the same inventory, asked another question. */
const NOW = new Date("2026-11-19T18:00:00Z");
let n = 0;
const wine = (over: Partial<CellarItem> & Pick<CellarItem, "wineName" | "type">): CellarItem => ({
  vintageId: `${(0x400000 + ++n).toString(16)}aa-0000-4000-8000-000000000000`,
  wineId: `w${n}`,
  producer: "Domaine Exemple",
  year: 2021,
  region: null,
  appellation: null,
  countryCode: null,
  count: 2,
  places: ["Rack"],
  unplaced: 0,
  image: null,
  favorite: false,
  rating: null,
  drink: {
    source: "estimate",
    reliable: false,
    uncertain: false,
    phase: "peak",
    from: 2022,
    until: 2031,
    urgency: 5,
    yearsUntilOpen: null,
    yearsLeft: 5,
    position: 0.5,
  },
  ...over,
});
const chablis = () =>
  wine({
    wineName: "Chablis",
    type: "white",
    appellation: "Chablis",
    region: "Burgundy",
    countryCode: "FR",
  });
const barolo = (year = 2020) =>
  wine({
    wineName: "Barolo",
    type: "red",
    appellation: "Barolo",
    region: "Piedmont",
    countryCode: "IT",
    year,
  });
const gevrey = (year: number) =>
  wine({
    wineName: "Gevrey-Chambertin",
    type: "red",
    appellation: "Gevrey-Chambertin",
    region: "Burgundy",
    countryCode: "FR",
    year,
  });
const pauillac = () =>
  wine({
    wineName: "Pauillac",
    type: "red",
    appellation: "Pauillac",
    region: "Bordeaux",
    countryCode: "FR",
  });
const tawny = () =>
  wine({
    wineName: "10 Year Old Tawny Port",
    type: "fortified",
    appellation: "Porto",
    region: "Douro",
    countryCode: "PT",
    year: null,
  });

function setup(
  items: CellarItem[],
  options: { experiences?: boolean; profiles?: Map<string, InsightOutput> } = {},
) {
  const intelligence = createSommelierIntelligence({
    cellar: async () => ({ items, bottleCount: items.reduce((s, i) => s + i.count, 0) }),
    profiles: async () => options.profiles ?? new Map(),
    taste: async () => null,
    offers: null,
    buying: true,
    experiences: options.experiences ?? true,
    now: () => NOW,
  });
  return (question: string, state?: unknown) =>
    intelligence.plan({ question, state, budgetEuros: null, personal: true, locale: "en" });
}

describe("how to serve a bottle", () => {
  it("answers for the owned wine that was named: temperature, decanting, glass, and what it rests on", async () => {
    const mine = chablis();
    const planned = (await setup([mine, pauillac()])(
      "At what temperature should I serve my Chablis?",
    ))!;
    expect(planned.plan.kind).toBe("serving");
    expect(planned.plan.serving).toHaveLength(1);
    expect(planned.plan.serving[0]).toMatchObject({
      vintageId: mine.vintageId,
      tempC: { min: 9, max: 11 },
      decant: { kind: "no", minutes: 0 },
      glass: "white",
      basis: "style",
      tier: "appellation",
    });
    // It is about a bottle, not a suggestion to open one.
    expect(planned.bottles).toEqual([]);
    expect(planned.otherBottles.map((b) => b.vintageId)).toEqual([mine.vintageId]);
    expect(SommelierPlanSchema.safeParse(planned.plan).success).toBe(true);
  });

  it("airs a young, firm red and pours an old bottle off its sediment", async () => {
    const young = barolo(2020);
    const old = gevrey(1999);
    const planned = (await setup([young, old])(
      "Should I decant the Barolo and the old Gevrey-Chambertin for Saturday?",
    ))!;
    const by = new Map(planned.plan.serving.map((s) => [s.vintageId, s.decant]));
    expect(by.get(young.vintageId)).toEqual({ kind: "air", minutes: 90 });
    expect(by.get(old.vintageId)).toEqual({ kind: "sediment", minutes: 0 });
  });

  it("uses the wine's own profile only when it is fact about this exact wine", async () => {
    const mine = chablis();
    const profile = (over: Partial<InsightOutput>): InsightOutput => ({
      summary: "x",
      style: "",
      grapes: [],
      tasting: "",
      serving: { minC: 12, maxC: 13 },
      decantMinutes: 0,
      abvPercent: null,
      drinkWindow: null,
      pairings: [],
      aging: "",
      structure: { body: 2, tannin: 1, sweetness: 1, acidity: 5 },
      flavors: [],
      pairingKinds: [],
      version: PROFILE_VERSION,
      value: null,
      confidence: "high",
      evidence: "exact_wine",
      researched: true,
      sources: [{ name: "P", url: "https://www.example.com" }],
      ...over,
    });
    const exact = (await setup([mine], { profiles: new Map([[mine.vintageId, profile({})]]) })(
      "How cold should my Chablis be?",
    ))!;
    expect(exact.plan.serving[0]).toMatchObject({ tempC: { min: 12, max: 13 }, basis: "profile" });
    const guess = (await setup([mine], {
      profiles: new Map([
        [mine.vintageId, profile({ evidence: "style_estimate", confidence: "low" })],
      ]),
    })("How cold should my Chablis be?"))!;
    expect(guess.plan.serving[0]).toMatchObject({ tempC: { min: 9, max: 11 }, basis: "style" });
  });

  it("does not make up a bottle: a wine the household does not own is not answered here", async () => {
    expect(await setup([pauillac()])("At what temperature should I serve my Chablis?")).toBeNull();
  });
});

describe("how long a bottle keeps", () => {
  it("gives the window the app already shows for it, and whether that is known or a guess", async () => {
    const mine = barolo(2017);
    const planned = (await setup([mine])("How long can I keep my Barolo?"))!;
    expect(planned.plan.kind).toBe("keeping");
    expect(planned.plan.keeping).toEqual([
      { vintageId: mine.vintageId, from: 2022, until: 2031, phase: "peak", reliable: false },
    ]);
  });
});

describe("what to cook with a bottle", () => {
  it("names dishes the engines call good with it, and what to steer away from", async () => {
    const mine = barolo();
    const planned = (await setup([mine])("What should I cook with my Barolo?"))!;
    expect(planned.plan.kind).toBe("wine-to-food");
    expect(planned.plan.dishIdeas.length).toBeGreaterThanOrEqual(3);
    expect(planned.plan.dishIdeas.every((d) => d.label.length > 0 && d.dishId.length > 0)).toBe(
      true,
    );
    // A firm red: fish and chili are what goes wrong with it.
    expect(planned.plan.avoid).toEqual(expect.arrayContaining(["tannin-with-fish"]));
    const ideas = planned.plan.dishIdeas.map((d) => d.dishId).join(" ");
    expect(ideas).not.toMatch(/oyster|sushi|ceviche|sole/);
  });
});

describe("a wine for every course", () => {
  it("gives each course its own owned wine, in the order of the menu", async () => {
    const white = chablis();
    const red = pauillac();
    const sweet = tawny();
    const planned = (await setup([red, white, sweet])(
      "Oysters to start, then roast lamb, and for dessert chocolate fondant. Which wine with each course?",
    ))!;
    expect(planned.plan.kind).toBe("menu");
    expect(planned.plan.courses.map((c) => c.pick?.vintageId ?? null)).toEqual([
      white.vintageId,
      red.vintageId,
      sweet.vintageId,
    ]);
    expect(planned.plan.courses.map((c) => c.dish)).toEqual([
      "oysters",
      "roast lamb",
      "chocolate fondant",
    ]);
  });

  it("says for which course nothing suits instead of pouring something anyway", async () => {
    const planned = (await setup([pauillac()])("Oysters to start, then roast lamb."))!;
    expect(planned.plan.courses.map((c) => c.outcome)).toEqual(["none", "good"]);
    expect(planned.plan.courses[0]!.pick).toBeNull();
  });
});

describe("enough bottles for the guests", () => {
  it("counts the free bottles of every wine that suits against half a bottle each", async () => {
    const a = { ...pauillac(), count: 3, reserved: { count: 1, title: "Kept", on: null } };
    const b = { ...barolo(2015), count: 1 };
    const planned = (await setup([a, b, chablis()])(
      "8 guests, roast lamb. Do I have enough bottles?",
    ))!;
    expect(planned.plan.kind).toBe("quantity");
    expect(planned.plan.quantity).toEqual({ guests: 8, needed: 4, available: 3, short: 1 });
    // The reserved bottle is not counted, and the white is not counted for lamb.
    expect(planned.plan.picks.map((p) => p.vintageId)).not.toContain(
      planned.plan.picks.find((p) => p.level === "neutral")?.vintageId,
    );
  });
});

describe("with the experiences switched off", () => {
  it("none of these questions is answered by the engines as an experience", async () => {
    const ask = setup([chablis(), barolo(), pauillac()], { experiences: false });
    expect(await ask("At what temperature should I serve my Chablis?")).toBeNull();
    expect(await ask("How long can I keep my Barolo?")).toBeNull();
    const menu = await ask("Oysters to start, then roast lamb.");
    expect(menu?.plan.kind).not.toBe("menu");
  });
});
