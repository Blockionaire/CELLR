import { describe, expect, it, vi } from "vitest";
import {
  SommelierPlanSchema,
  type CellarItem,
  type FriendCellar,
  type MentionStatus,
} from "@cellr/domain";
import type { TasteSignals } from "@cellr/domain/intelligence";
import { createSommelierIntelligence } from "./intelligence";

/**
 * A FRIEND'S CELLAR IN MY SOMMELIER'S ANSWER (migration 0050). The database decides whether it may be looked at
 * (`friendCellar` here plays the database); these tests hold the engine to what it does with the answer: their
 * bottles are shown as theirs and never as mine, a cellar that is not shared says nothing about what they own,
 * a present leaves out what was found there and claims no more than "not found in what they share", and their
 * cellar is only ever asked for when the question is about it.
 */
let n = 0;
const mine = (wineName: string, type: CellarItem["type"], appellation: string): CellarItem => ({
  vintageId: `${(0x600000 + ++n).toString(16)}aa-0000-4000-8000-000000000000`,
  wineId: `w${n}`,
  producer: "Domaine Mien",
  wineName,
  type,
  year: 2020,
  region: null,
  appellation,
  countryCode: "FR",
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
});
const theirs = (
  name: string,
  type: FriendCellar["wines"][number]["type"],
  appellation: string,
  region: string,
) => ({
  producer: "Domaine Thomas",
  name,
  year: 2019,
  type,
  region,
  appellation,
  countryCode: "FR",
});
const THOMAS: FriendCellar = {
  status: "included",
  wines: [
    theirs("Gevrey-Chambertin", "red", "Gevrey-Chambertin", "Burgundy"),
    theirs("Pauillac", "red", "Pauillac", "Bordeaux"),
    theirs("Muscadet", "white", "Muscadet", "Loire"),
  ],
};

function setup(
  cellar: FriendCellar | "fails" | null,
  options: { status?: MentionStatus; taste?: TasteSignals | null; own?: CellarItem[] } = {},
) {
  const own = options.own ?? [mine("Chablis", "white", "Chablis")];
  const looked: string[] = [];
  const intelligence = createSommelierIntelligence({
    cellar: async () => ({ items: own, bottleCount: own.length * 2 }),
    profiles: async () => new Map(),
    taste: async () => null,
    offers: null,
    buying: true,
    friends: async (handles) =>
      handles.map((handle) =>
        handle === "thomas"
          ? { handle, status: options.status ?? "included", taste: options.taste ?? null }
          : { handle, status: "unavailable" as const, taste: null },
      ),
    ...(cellar === null
      ? {}
      : {
          friendCellar: async (handle: string) => {
            looked.push(handle);
            if (cellar === "fails") throw new Error("database down");
            return cellar;
          },
        }),
    now: () => new Date("2026-11-20T18:00:00Z"),
  });
  const ask = (question: string, state?: unknown, earlier?: string[]) =>
    intelligence.plan({
      question,
      state,
      budgetEuros: null,
      personal: true,
      locale: "en",
      ...(earlier ? { earlier } : {}),
    });
  return { ask, looked, own };
}

const BRINGING =
  "@thomas is bringing a bottle. What does he own that suits both of us with roast lamb?";

describe("what a friend owns that suits", () => {
  it("judges their wines against the dish and shows them as theirs, with none of mine beside them", async () => {
    const { ask, looked } = setup(THOMAS);
    const planned = (await ask(BRINGING))!;
    expect(looked).toEqual(["thomas"]);
    const fc = planned.plan.friendCellar!;
    expect(fc).toMatchObject({ handle: "thomas", status: "used", outcome: "good" });
    // The reds suit lamb; the Muscadet does not, and is not offered.
    const names = fc.picks.map((p) => p.name);
    expect(names).toContain("Pauillac");
    expect(names).not.toContain("Muscadet");
    expect(fc.picks.every((p) => p.producer === "Domaine Thomas")).toBe(true);
    // Nothing of theirs is passed off as a bottle of mine: no cards, no picks, no ids.
    expect(planned.bottles).toEqual([]);
    expect(planned.otherBottles).toEqual([]);
    expect(planned.plan.picks).toEqual([]);
    expect(planned.plan.state.offered).toEqual([]);
    expect(SommelierPlanSchema.safeParse(planned.plan).success).toBe(true);
  });

  it("says so when nothing of theirs suits, instead of offering something anyway", async () => {
    const whites: FriendCellar = { status: "included", wines: [THOMAS.wines[2]!] };
    const planned = (await setup(whites).ask(BRINGING))!;
    expect(planned.plan.friendCellar).toMatchObject({ status: "used", outcome: "none", picks: [] });
  });

  it("a cellar that is not shared: nothing about what they own is said, inferred or named", async () => {
    const secret: FriendCellar = { status: "not-shared", wines: [] };
    const planned = (await setup(secret).ask(BRINGING))!;
    expect(planned.plan.friendCellar).toEqual({
      handle: "thomas",
      status: "not-shared",
      outcome: null,
      picks: [],
      leftOut: [],
    });
    // (The advice on what to buy may name a style such as Pauillac: that is the buying engine, not his cellar.)
    expect(JSON.stringify(planned.plan)).not.toMatch(/Domaine Thomas/);
    expect(
      planned.plan.picks.every((p) => planned.bottles.some((b) => b.vintageId === p.vintageId)),
    ).toBe(true);
    // The asker still gets an answer about their own cellar.
    expect(planned.plan.dish).toMatch(/lamb/i);
  });

  it("uses nothing when the database cannot answer, and never invents a status", async () => {
    const planned = (await setup("fails").ask(BRINGING))!;
    expect(planned.plan.friendCellar?.status).toBe("not-shared");
    expect(planned.plan.friendCellar?.picks).toEqual([]);
  });

  it("is only looked at when the question is about what one friend owns", async () => {
    const { ask, looked } = setup(THOMAS);
    // A friend at the table is not a question about their cellar.
    const table = (await ask("@thomas is coming for roast lamb. What should I open?"))!;
    expect(looked).toEqual([]);
    expect(table.plan.friendCellar).toBeNull();
    // Two names: whose cellar? Not looked at.
    await ask("@thomas and @carla are bringing a bottle. What do they own for roast lamb?");
    expect(looked).toEqual([]);
    // Someone who is not a friend: never asked for, whatever the question says.
    await ask("@stranger is bringing a bottle. What does he own that suits roast lamb?");
    expect(looked).toEqual([]);
  });

  it("is never looked at for a name the database did not call a friend", async () => {
    const { ask, looked } = setup(THOMAS, { status: "unavailable" });
    const planned = (await ask(BRINGING))!;
    expect(looked).toEqual([]);
    expect(planned.plan.friendCellar).toBeNull();
    expect(planned.plan.friends).toEqual([{ handle: "thomas", status: "unavailable" }]);
  });

  it("without the reader (the switch off, or the database step not taken) nothing changes", async () => {
    const planned = (await setup(null).ask(BRINGING))!;
    expect(planned.plan.friendCellar).toBeNull();
  });
});

describe("a present they do not have yet", () => {
  const GIFT =
    "I want to buy @thomas a birthday gift under €50. What suits his taste that he does not already own?";
  const likesBordeaux: TasteSignals = {
    focus: "red",
    said: {},
    trends: {},
    styles: ["red"],
    likes: ["bordeaux"],
  };

  it("advises what the receiver likes, and leaves out what is found in the cellar they share", async () => {
    // Thomas likes Bordeaux. With nothing in the cellar he shares, a Bordeaux is advised...
    const empty = (await setup({ status: "included", wines: [] }, { taste: likesBordeaux }).ask(
      GIFT,
    ))!;
    expect(empty.plan.kind).toBe("buying");
    expect(empty.plan.friendCellar).toMatchObject({ status: "used", leftOut: [] });
    const first = empty.plan.styles[0]!;
    expect(first.reason).toBe("liked");
    expect(first.label).toMatch(/Bordeaux|Pauillac|Émilion|Médoc|Pomerol|Margaux/);

    // ...and with that very wine in it, that style is left out, said to be, and another he likes is advised.
    const has = {
      ...theirs("x", "red", "x", "Bordeaux"),
      name: first.label,
      appellation: first.label.replace(/ \(.*$/, ""),
    };
    const withIt = setup({ status: "included", wines: [has] }, { taste: likesBordeaux });
    const planned = (await withIt.ask(GIFT))!;
    expect(withIt.looked).toEqual(["thomas"]);
    expect(planned.plan.friendCellar!.leftOut).toContain(first.label);
    expect(planned.plan.styles.map((s) => s.styleId)).not.toContain(first.styleId);
    expect(planned.plan.styles.length).toBeGreaterThan(0);
    expect(planned.plan.styles.every((s) => s.fromEuros <= 50)).toBe(true);
    // No offer, shop or price of a bottle appears because a friend was named.
    expect(planned.plan.offers).toEqual([]);
    expect(planned.plan.offerCheck).toBe("no-provider");
    expect(SommelierPlanSchema.safeParse(planned.plan).success).toBe(true);
  });

  it("chooses for the receiver: the giver's own taste does not steer a present", async () => {
    const intelligence = createSommelierIntelligence({
      cellar: async () => ({ items: [], bottleCount: 0 }),
      profiles: async () => new Map(),
      // The giver loves sweet wine.
      taste: async () => null,
      offers: null,
      buying: true,
      friends: async (handles) =>
        handles.map((handle) => ({ handle, status: "included" as const, taste: likesBordeaux })),
      friendCellar: async () => ({ status: "included" as const, wines: [] }),
      now: () => new Date("2026-11-20T18:00:00Z"),
    });
    const planned = (await intelligence.plan({
      question: GIFT,
      state: undefined,
      budgetEuros: null,
      personal: true,
      locale: "en",
    }))!;
    expect(planned.plan.styles[0]!.reason).toBe("liked");
  });

  it("with a cellar that is not shared: advice all the same, and no claim about what they own", async () => {
    const planned = (await setup({ status: "not-shared", wines: [] }, { taste: likesBordeaux }).ask(
      GIFT,
    ))!;
    expect(planned.plan.styles.length).toBeGreaterThan(0);
    expect(planned.plan.friendCellar).toMatchObject({ status: "not-shared", leftOut: [] });
  });

  it("the state that travels to the screen and back never holds their wines or their taste", async () => {
    const planned = (await setup(THOMAS, { taste: likesBordeaux }).ask(GIFT))!;
    const state = JSON.stringify(planned.plan.state);
    expect(state).not.toMatch(/Gevrey|Pauillac|Muscadet|Domaine Thomas|bordeaux/i);
  });
});

describe("the reader is never trusted for more than wines", () => {
  it("keeps going when the database answers with a cellar of three hundred wines", async () => {
    const many: FriendCellar = {
      status: "included",
      wines: Array.from({ length: 300 }, (_, i) =>
        theirs(`Pauillac ${i}`, "red", "Pauillac", "Bordeaux"),
      ),
    };
    const reader = vi.fn(async () => many);
    const intelligence = createSommelierIntelligence({
      cellar: async () => ({ items: [], bottleCount: 0 }),
      profiles: async () => new Map(),
      taste: async () => null,
      offers: null,
      buying: true,
      friends: async (handles) =>
        handles.map((handle) => ({ handle, status: "included" as const, taste: null })),
      friendCellar: reader,
      now: () => new Date("2026-11-20T18:00:00Z"),
    });
    const started = performance.now();
    const planned = (await intelligence.plan({
      question: BRINGING,
      state: undefined,
      budgetEuros: null,
      personal: true,
      locale: "en",
    }))!;
    expect(performance.now() - started).toBeLessThan(1500);
    expect(planned.plan.friendCellar!.picks.length).toBeLessThanOrEqual(3);
  });
});

describe("a friend stays in the conversation", () => {
  const VISIT = "@thomas is coming over, we are having roast lamb. What do we open?";
  const own = () => [
    mine("Pauillac", "red", "Pauillac"),
    mine("Chablis", "white", "Chablis"),
    mine("Sancerre", "white", "Sancerre"),
  ];

  it("a follow-up that names nobody is still about the friend the conversation named", async () => {
    const { ask } = setup(null, { own: own() });
    const first = await ask(VISIT);
    expect(first!.plan.friends).toEqual([{ handle: "thomas", status: "included" }]);
    const next = await ask("And with grilled sea bass?", first!.plan.state, [VISIT]);
    expect(next!.plan.friends).toEqual([{ handle: "thomas", status: "included" }]);
    // The name is carried by the asker's own words only: never in the state that travels with the conversation.
    expect(JSON.stringify(next!.plan.state)).not.toContain("thomas");
  });

  it("asks the database again in the follow-up: consent withdrawn between two turns ends it", async () => {
    const before = setup(null, { own: own() });
    const first = await before.ask(VISIT);
    // Between the two questions the friend switched their consent off: the database now says so.
    const after = setup(null, { own: own(), status: "no-taste" });
    const next = await after.ask("And with grilled sea bass?", first!.plan.state, [VISIT]);
    expect(next!.plan.friends).toEqual([{ handle: "thomas", status: "no-taste" }]);
  });

  it("a friendship ended between two turns: the follow-up says the name is nobody's", async () => {
    const before = setup(null, { own: own() });
    const first = await before.ask(VISIT);
    const after = setup(THOMAS, { own: own(), status: "unavailable" });
    const next = await after.ask("And what does he own for the fish?", first!.plan.state, [VISIT]);
    expect(next!.plan.friends).toEqual([{ handle: "thomas", status: "unavailable" }]);
    // A name the database does not call a friend: their cellar is not even asked for.
    expect(after.looked).toEqual([]);
    expect(next!.plan.friendCellar).toBeNull();
  });

  it("a new conversation carries nobody, whatever earlier questions the screen sends along", async () => {
    const { ask } = setup(null, { own: own() });
    const plan = await ask("What do I open with grilled sea bass?", undefined, [VISIT]);
    expect(plan!.plan.friends).toEqual([]);
  });

  it("naming someone else replaces who the conversation is about", async () => {
    const { ask } = setup(null, { own: own() });
    const first = await ask(VISIT);
    const next = await ask("And if @lisa joins, with grilled sea bass?", first!.plan.state, [
      VISIT,
    ]);
    expect(next!.plan.friends).toEqual([{ handle: "lisa", status: "unavailable" }]);
  });

  it("the last friend named is the one carried, not an older one", async () => {
    const { ask } = setup(null, { own: own() });
    const first = await ask(VISIT);
    const next = await ask("And with grilled sea bass?", first!.plan.state, [
      "@lisa likes white. What do I open with oysters?",
      VISIT,
    ]);
    expect(next!.plan.friends.map((f) => f.handle)).toEqual(["thomas"]);
  });

  it("a present keeps leaving out what they own when the follow-up only gives the budget", async () => {
    const likes: TasteSignals = {
      focus: "red",
      styles: ["red"],
      likes: ["bordeaux"],
      said: {},
      trends: {},
    };
    const GIFT = "I want to buy @thomas a present that he does not already own.";
    // What would be advised first if he shared nothing...
    const nothing = setup({ status: "included", wines: [] }, { taste: likes });
    const open = await nothing.ask(GIFT);
    const wanted = (await nothing.ask("Up to 50 euros", open!.plan.state, [GIFT]))!.plan.styles[0]!;
    // ...is left out, in the follow-up too, once that very wine is among what he shares.
    const has = {
      ...theirs("x", "red", "x", "Bordeaux"),
      name: wanted.label,
      appellation: wanted.label.replace(/ \(.*$/, ""),
    };
    const { ask, looked } = setup({ status: "included", wines: [has] }, { taste: likes });
    const first = await ask(GIFT);
    const next = (await ask("Up to 50 euros", first!.plan.state, [GIFT]))!;
    expect(looked).toEqual(["thomas", "thomas"]);
    expect(next.plan.friends).toEqual([{ handle: "thomas", status: "included" }]);
    expect(next.plan.kind).toBe("buying");
    expect(next.plan.styles.length).toBeGreaterThan(0);
    expect(next.plan.styles.map((s) => s.styleId)).not.toContain(wanted.styleId);
    expect(next.plan.friendCellar).toMatchObject({ status: "used" });
    expect(next.plan.friendCellar!.leftOut).toContain(wanted.label);
  });

  it("their cellar is left alone once the follow-up turns to my own wines", async () => {
    const { ask, looked } = setup(THOMAS, { own: own() });
    const first = await ask(BRINGING);
    expect(first!.plan.friendCellar?.status).toBe("used");
    const next = await ask("And what do I have myself for the lamb?", first!.plan.state, [
      BRINGING,
    ]);
    expect(looked).toEqual(["thomas"]);
    expect(next!.plan.friendCellar).toBeNull();
    expect(next!.plan.friends).toEqual([{ handle: "thomas", status: "included" }]);
  });

  it("a question that stands on its own is answered from my cellar again, not from theirs", async () => {
    const mineForOysters = [
      mine("Muscadet", "white", "Muscadet"),
      mine("Chablis", "white", "Chablis"),
    ];
    const { ask, looked } = setup(THOMAS, { own: mineForOysters });
    const first = await ask(BRINGING);
    expect(first!.plan.friendCellar?.status).toBe("used");
    const next = await ask("What goes with oysters tonight?", first!.plan.state, [BRINGING]);
    expect(looked).toEqual(["thomas"]);
    expect(next!.plan.friendCellar).toBeNull();
    expect(next!.bottles.length).toBeGreaterThan(0);
    expect(next!.bottles.every((b) => b.producer === "Domaine Mien")).toBe(true);
  });

  it('"I do not have any…" is about my cellar: theirs is not read and nothing of it is said', async () => {
    const { ask, looked } = setup(THOMAS);
    const plan = await ask(
      "@thomas is coming for oysters on Saturday. I do not have any Champagne, what should I buy?",
    );
    expect(looked).toEqual([]);
    expect(plan!.plan.friendCellar).toBeNull();
  });

  it("a follow-up about another dish still looks at what they own", async () => {
    const { ask, looked } = setup(THOMAS);
    const first = await ask(BRINGING);
    const next = await ask("And with oysters?", first!.plan.state, [BRINGING]);
    expect(looked).toEqual(["thomas", "thomas"]);
    expect(next!.plan.friendCellar?.status).toBe("used");
    expect(next!.plan.friendCellar?.picks.map((p) => p.name)).toContain("Muscadet");
  });
});
