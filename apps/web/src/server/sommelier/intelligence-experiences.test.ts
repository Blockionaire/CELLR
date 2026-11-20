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
      { vintageId: mine.vintageId, from: 2022, until: 2031, phase: "peak", basis: "style" },
    ]);
  });

  it("says what the window rests on: the person's own, the wine's profile, or the style's guess", async () => {
    const own = { ...barolo(2017), drink: { ...barolo().drink, source: "own" as const } };
    const ai = {
      ...barolo(2016),
      drink: { ...barolo().drink, source: "ai" as const, reliable: true },
    };
    expect((await setup([own])("How long can I keep my Barolo?"))!.plan.keeping[0]!.basis).toBe(
      "own",
    );
    // A profile's window is an estimate from what is known, never "known" outright.
    expect((await setup([ai])("How long can I keep my Barolo?"))!.plan.keeping[0]!.basis).toBe(
      "profile",
    );
  });

  it("leaves an opened bottle alone: how long that lasts is days, not its drinking window", async () => {
    const ask = setup([barolo(2017), chablis()]);
    expect(await ask("How long can I keep my Barolo once it is opened?")).toBeNull();
    expect(await ask("How long can I keep an open bottle of Chablis in the fridge?")).toBeNull();
    expect(await ask("Hoe lang kan ik een geopende fles Barolo bewaren?")).toBeNull();
  });
});

describe("a dish and a question about what to pour is a pairing, whatever else is mentioned", () => {
  const cellar = () => [barolo(2018), chablis(), pauillac()];
  it("a bottle to keep, or one not to decant, does not take the question over", async () => {
    const ask = setup(cellar());
    const keep = (await ask("Ik wil mijn Barolo nog bewaren. Wat schenk ik bij de lasagne?"))!;
    expect(keep.plan.kind).toBe("pairing");
    expect(keep.plan.keeping).toEqual([]);
    const decant = (await ask("I do not want to decant my Barolo. Which wine with the steak?"))!;
    expect(decant.plan.kind).toBe("pairing");
    expect(decant.plan.serving).toEqual([]);
  });

  it("'what suits my lasagne: the Barolo or the Chablis' is about the lasagne, not dishes for a wine", async () => {
    const planned = (await setup(cellar())("Wat past bij mijn lasagne: de Barolo of de Chablis?"))!;
    expect(planned.plan.kind).not.toBe("wine-to-food");
    expect(planned.plan.dishIdeas).toEqual([]);
    expect(planned.plan.dish).toMatch(/lasagne/i);
  });

  it("two wines and a dish is a choice between them, also when decanting is asked in passing", async () => {
    const planned = (await setup(cellar())(
      "Barolo or Pauillac with the lamb, and should I decant it?",
    ))!;
    expect(planned.plan.serving).toEqual([]);
    expect(planned.plan.dish).toMatch(/lamb/i);
  });

  it("serving stays serving when a dish is only the occasion", async () => {
    const planned = (await setup(cellar())(
      "How cold should I serve my Chablis with the oysters?",
    ))!;
    expect(planned.plan.kind).toBe("serving");
  });
});

describe("a wish for a colour does not hide a bottle asked about by name", () => {
  it("'which red with the lamb', then 'how do I serve my Chablis': the Chablis", async () => {
    const white = chablis();
    const ask = setup([pauillac(), white]);
    const first = (await ask("Which red with the roast lamb?"))!;
    expect(first.plan.state.wineType).toBe("red");
    const second = (await ask("At what temperature should I serve my Chablis?", first.plan.state))!;
    expect(second.plan.kind).toBe("serving");
    expect(second.plan.serving.map((s) => s.vintageId)).toEqual([white.vintageId]);
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
    // What the ideas rest on is said: this Barolo is known by its appellation, not as this exact wine.
    expect(planned.plan.dishIdeasTier).toBe("appellation");
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

  it("pours a wine twice only when no other way gives every course as good a match", async () => {
    const sancerre = wine({
      wineName: "Sancerre",
      type: "white",
      appellation: "Sancerre",
      region: "Loire",
      countryCode: "FR",
    });
    const meursault = wine({
      wineName: "Meursault",
      type: "white",
      appellation: "Meursault",
      region: "Burgundy",
      countryCode: "FR",
    });
    const planned = (await setup([chablis(), sancerre, meursault])(
      "Oysters to start, then roast chicken, then salmon. Which wine with each course?",
    ))!;
    const poured = planned.plan.courses.map((c) => c.pick?.vintageId ?? null);
    expect(poured.every((id) => id !== null)).toBe(true);
    // Three courses, three whites that suit: none is poured twice.
    expect(new Set(poured).size).toBe(3);
    expect(planned.plan.courses.some((c) => c.shared)).toBe(false);
  });

  it("flags a wine that had to be poured twice", async () => {
    const planned = (await setup([pauillac()])("Roast lamb to start, then beef stew."))!;
    expect(planned.plan.courses.map((c) => c.shared)).toEqual([true, true]);
  });

  it("does not make a menu out of a sauce, a verb, or yesterday's dinner", async () => {
    const ask = setup([chablis(), pauillac()]);
    // "then I add a cream sauce" is part of the chicken, not a course without a wine.
    expect((await ask("Roast chicken, then I add a cream sauce. What wine?"))?.plan.kind).not.toBe(
      "menu",
    );
    // Dutch "toe" in "voeg ... toe" is a verb, not dessert.
    expect((await ask("Ik voeg kaas toe aan de pasta. Welke wijn?"))?.plan.kind).not.toBe("menu");
    // A semicolon alone does not make courses.
    expect((await ask("I had oysters yesterday; tonight roast lamb"))?.plan.kind).not.toBe("menu");
  });

  it("says so when a course could not be read, instead of dropping it or calling it unsuited", async () => {
    const planned = (await setup([chablis(), pauillac()])(
      "Oysters to start, then qwertzu, then roast lamb",
    ))!;
    expect(planned.plan.kind).toBe("menu");
    expect(planned.plan.courses.map((c) => [c.dish, c.unread])).toEqual([
      ["oysters", false],
      ["qwertzu", true],
      ["roast lamb", false],
    ]);
    expect(planned.plan.courses[1]!.pick).toBeNull();
  });

  it("reads a plain list as a menu when the person says it is one", async () => {
    const white = chablis();
    const red = pauillac();
    const planned = (await setup([white, red, tawny()])(
      "Oysters, roast lamb and chocolate fondant. Which wine with each course?",
    ))!;
    expect(planned.plan.kind).toBe("menu");
    expect(planned.plan.courses).toHaveLength(3);
    expect(planned.plan.courses[0]!.pick?.vintageId).toBe(white.vintageId);
    expect(planned.plan.courses[1]!.pick?.vintageId).toBe(red.vintageId);
  });

  it("answers a Dutch menu in the person's own words", async () => {
    const planned = (await setup([chablis(), pauillac()])(
      "Vooraf oesters, daarna lamsbout. Welke wijn per gang?",
    ))!;
    expect(planned.plan.kind).toBe("menu");
    expect(planned.plan.courses.map((c) => c.dish)).toEqual(["oesters", "lamsbout"]);
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
    const white = planned.plan.picks.find(
      (p) => p.vintageId !== a.vintageId && p.vintageId !== b.vintageId,
    );
    expect(white).toBeUndefined();
    expect(planned.plan.picks.map((p) => p.vintageId).sort()).toEqual(
      [a.vintageId, b.vintageId].sort(),
    );
  });
});

describe("what is a question of fact stays one", () => {
  const facts = (question: string) =>
    createSommelierIntelligence({
      cellar: async () => ({ items: [], bottleCount: 0 }),
      profiles: async () => new Map(),
      taste: async () => null,
      offers: null,
      buying: true,
      experiences: true,
      now: () => NOW,
    }).asksEnoughFor(question);

  it("guests and a dish with 'enough' or 'need' is the engines'", () => {
    expect(facts("8 guests, roast lamb. Do I have enough bottles?")).toBe(true);
    expect(facts("How many bottles do I need for 8 guests with roast lamb?")).toBe(true);
    expect(facts("8 gasten, lamsbout. Heb ik genoeg wijn?")).toBe(true);
  });

  it("a count or a place is not, whatever else the question says", () => {
    expect(facts("I have 8 guests and roast lamb. How many bottles of the Barolo do I have?")).toBe(
      false,
    );
    expect(
      facts("Where is my Barolo? 8 guests are coming for roast lamb and I want enough wine."),
    ).toBe(false);
    expect(facts("Waar ligt mijn Barolo? 8 gasten, ik wil genoeg wijn bij de lamsbout")).toBe(
      false,
    );
    expect(facts("How many bottles do I have?")).toBe(false);
    expect(facts("Do I have enough bottles for 8 guests?")).toBe(false);
  });

  it("a number that is not a number of guests does not make it one", () => {
    expect(facts("600 guests, roast lamb. Do I have enough bottles?")).toBe(false);
    expect(facts("0 guests, roast lamb. Do I have enough bottles?")).toBe(false);
    expect(facts("Roast lamb for 2019. Do I have enough bottles?")).toBe(false);
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
