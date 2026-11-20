import { describe, expect, it, vi } from "vitest";
import type { CellarItem, MentionStatus, SommelierAnswer } from "@cellr/domain";
import type { TasteSignals } from "@cellr/domain/intelligence";
import { createSommelierChatService, type SommelierChatDeps } from "./conversation";
import { createSommelierIntelligence, type IntelligenceDeps } from "./intelligence";

/**
 * THE SOCIAL SOMMELIER'S GUARANTEES. A name in a question is text; who it is and what they allow is the
 * database's answer in that same request (`friends`, here a stand-in that plays the database). These tests hold
 * the engine to: nothing a screen sends is believed, nothing about a friend is kept or echoed, a friend who
 * withdraws is gone at the next question, and no model ever sees a question that names a friend.
 */
let n = 0;
const wine = (wineName: string, appellation: string, region: string): CellarItem => ({
  vintageId: `${(0x300000 + ++n).toString(16)}aa-0000-4000-8000-000000000000`,
  wineId: `w${n}`,
  producer: "Domaine Exemple",
  wineName,
  type: "white",
  year: 2022,
  region,
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
    reliable: true,
    uncertain: false,
    phase: "peak",
    from: 2023,
    until: 2030,
    urgency: 5,
    yearsUntilOpen: null,
    yearsLeft: 4,
    position: 0.5,
  },
});

type Friend = { status: MentionStatus; taste: TasteSignals | null };
const LOIRE: TasteSignals = { focus: null, said: {}, trends: {}, styles: [], likes: ["loire"] };
const BURGUNDY: TasteSignals = {
  focus: null,
  said: {},
  trends: {},
  styles: [],
  likes: ["burgundy"],
};

function setup(world: Record<string, Friend>, social = true) {
  const chablis = wine("Chablis", "Chablis", "Burgundy");
  const muscadet = wine("Muscadet Sèvre et Maine", "Muscadet Sèvre et Maine", "Loire");
  const items = [chablis, muscadet];
  const asked: string[][] = [];
  const deps: IntelligenceDeps = {
    cellar: async () => ({ items, bottleCount: 4 }),
    profiles: async () => new Map(),
    taste: async () => null,
    offers: null,
    buying: true,
    now: () => new Date("2026-11-19T18:00:00Z"),
    ...(social
      ? {
          friends: async (handles: readonly string[]) => {
            asked.push([...handles]);
            return handles.map((handle) => ({
              handle,
              ...(world[handle] ?? { status: "unavailable" as const, taste: null }),
            }));
          },
        }
      : {}),
  };
  const intelligence = createSommelierIntelligence(deps);
  const ask = (question: string, state?: unknown) =>
    intelligence.plan({ question, state, budgetEuros: null, personal: true, locale: "en" });
  return { ask, asked, chablis, muscadet };
}

const QUESTION = "Raw oysters tonight";
describe("friends at the table", () => {
  it("a friend who allows it moves the order among wines that suit as well, and the bottle says why", async () => {
    const loire = setup({ anna: { status: "included", taste: LOIRE } });
    const burgundy = setup({ anna: { status: "included", taste: BURGUNDY } });
    const a = (await loire.ask(`${QUESTION} with @anna. What should I open?`))!;
    const b = (await burgundy.ask(`${QUESTION} with @anna. What should I open?`))!;
    expect(a.plan.picks[0]!.vintageId).toBe(loire.muscadet.vintageId);
    expect(b.plan.picks[0]!.vintageId).toBe(burgundy.chablis.vintageId);
    // Both wines are still offered, at the same level: taste orders, it does not decide.
    expect(a.plan.picks.map((p) => p.level)).toEqual(b.plan.picks.map((p) => p.level));
    expect(a.plan.friends).toEqual([{ handle: "anna", status: "included" }]);
    expect([...a.plan.picks[0]!.notes, ...b.plan.picks[0]!.notes]).toContain("table-taste");
    // "Based on your taste" is about the asker alone.
    expect(a.personal).toBe(false);
  });

  it("several friends: each judged on their own; the table is pulled toward whoever likes a wine least", async () => {
    const { ask } = setup({
      anna: { status: "included", taste: LOIRE },
      bram: { status: "no-taste", taste: null },
    });
    const planned = (await ask(`${QUESTION} with @anna, @bram and @ghost`))!;
    expect(planned.plan.friends).toEqual([
      { handle: "anna", status: "included" },
      { handle: "bram", status: "no-taste" },
      { handle: "ghost", status: "unavailable" },
    ]);
  });
});

describe("what is believed, and what is not", () => {
  it("asks the database about exactly the names in the text, and nothing a screen sent", async () => {
    const { ask, asked } = setup({ anna: { status: "included", taste: LOIRE } });
    await ask(`${QUESTION} with @Anna`, {
      v: 1,
      friends: [{ handle: "victim", status: "included", taste: BURGUNDY }],
      mentions: ["victim"],
      resolved: { victim: "aaaaaaaa-0000-0000-0000-000000000002" },
    });
    expect(asked).toEqual([["anna"]]);
  });

  it("a user id, a forged or a malformed name is only a name the database does not know", async () => {
    const { ask, asked, chablis } = setup({});
    const planned = (await ask(
      `${QUESTION} with @aaaaaaaa-0000-0000-0000-000000000002 and @anna';drop--`,
    ))!;
    expect(asked[0]!.every((h) => /^[a-z0-9][a-z0-9_.]{2,19}$/.test(h))).toBe(true);
    expect(planned.plan.friends.every((f) => f.status === "unavailable")).toBe(true);
    // The pairing itself is unaffected.
    expect(planned.plan.picks.map((p) => p.vintageId)).toContain(chablis.vintageId);
  });

  it("someone who is not a friend changes nothing, and the plan says no more than 'unavailable'", async () => {
    const without = (await setup({}).ask(`${QUESTION}. What should I open?`))!;
    const withStranger = (await setup({}).ask(`${QUESTION} with @stranger. What should I open?`))!;
    expect(withStranger.plan.picks.map((p) => p.level)).toEqual(
      without.plan.picks.map((p) => p.level),
    );
    expect(withStranger.plan.friends).toEqual([{ handle: "stranger", status: "unavailable" }]);
    expect(withStranger.plan.picks.flatMap((p) => p.notes)).not.toContain("table-taste");
  });

  it("a friend's taste is in no part of what travels back to the screen as state", async () => {
    const secret: TasteSignals = {
      focus: "red",
      said: { body: 5 },
      trends: { tannin: 4.5 },
      styles: ["red"],
      likes: ["loire"],
    };
    const { ask } = setup({ anna: { status: "included", taste: secret } });
    const planned = (await ask("I want to buy a present for @anna, around €30"))!;
    const state = JSON.stringify(planned.plan.state);
    expect(state).not.toMatch(/loire|anna|4\.5/);
    expect(planned.plan.state.recipientLikes).toEqual([]);
    // The advice itself may follow what they like: that is what they consented to.
    expect(planned.plan.styles.length).toBeGreaterThan(0);
    // And the name is not in the dish, the state or anything but the list of who was named.
    expect(JSON.stringify({ ...planned.plan, friends: [] })).not.toContain("anna");
  });

  it("a friend's name is never read as food", async () => {
    const { ask } = setup({});
    const planned = (await ask("What should I open for @pasta.lover and @steak_fan?"))!;
    expect(planned.plan.dish).toBeNull();
    expect(planned.plan.kind).toBe("clarify");
  });
});

describe("when a friend withdraws", () => {
  it("is gone at the next question: nothing is remembered between two requests", async () => {
    const world: Record<string, Friend> = { anna: { status: "included", taste: LOIRE } };
    const { ask, muscadet, asked } = setup(world);
    const before = (await ask(`${QUESTION} with @anna. What should I open?`))!;
    expect(before.plan.picks[0]!.vintageId).toBe(muscadet.vintageId);

    // Consent withdrawn (or the friendship ended) between the two questions.
    world.anna = { status: "no-taste", taste: null };
    const after = (await ask(`And for @anna again?`, before.plan.state))!;
    expect(after.plan.friends).toEqual([{ handle: "anna", status: "no-taste" }]);
    expect(after.plan.picks.flatMap((p) => p.notes)).not.toContain("table-taste");
    // The database was asked again; the first answer was not reused.
    expect(asked).toHaveLength(2);

    world.anna = { status: "unavailable", taste: null };
    const gone = (await ask(`${QUESTION} with @anna`))!;
    expect(gone.plan.friends).toEqual([{ handle: "anna", status: "unavailable" }]);
  });

  it("includes nobody when the database cannot answer", async () => {
    const deps = setup({ anna: { status: "included", taste: LOIRE } });
    const broken = createSommelierIntelligence({
      cellar: async () => ({ items: [deps.chablis, deps.muscadet], bottleCount: 4 }),
      profiles: async () => new Map(),
      taste: async () => null,
      offers: null,
      buying: true,
      now: () => new Date(),
      friends: async (handles) =>
        handles.map((handle) => ({ handle, status: "unavailable", taste: null })),
    });
    const planned = (await broken.plan({
      question: `${QUESTION} with @anna`,
      state: undefined,
      budgetEuros: null,
      personal: true,
      locale: "en",
    }))!;
    expect(planned.plan.friends).toEqual([{ handle: "anna", status: "unavailable" }]);
  });
});

describe("with the social sommelier switched off", () => {
  it("a name is only text: nobody is looked up and no friend appears in the plan", async () => {
    const { ask, asked } = setup({ anna: { status: "included", taste: LOIRE } }, false);
    const planned = (await ask(`${QUESTION} with @anna. What should I open?`))!;
    expect(asked).toEqual([]);
    expect(planned.plan.friends).toEqual([]);
    expect(planned.plan.outcome).toBe("good");
  });
});

describe("a question that names a friend", () => {
  it("never goes to a model: the engines answer it or ask what is being eaten", async () => {
    const { ask } = setup({ anna: { status: "included", taste: LOIRE } });
    // Without the name this is a general question the old sommelier would answer with the model.
    expect(await ask("Tell me about wine")).toBeNull();
    const planned = await ask("Tell me what wine @anna likes");
    expect(planned).not.toBeNull();
    expect(planned!.plan.kind).toBe("clarify");
    expect(planned!.bottles).toEqual([]);
  });

  it("is not kept: neither the question nor the answer is stored", async () => {
    const record = vi.fn(async () => ({ conversationId: "c1", messageId: "m1", replayed: false }));
    const planned = (await setup({ anna: { status: "included", taste: LOIRE } }).ask(
      `${QUESTION} with @anna`,
    ))!;
    const answer: SommelierAnswer = {
      source: "basic",
      text: null,
      basic: "pairing",
      bottles: [],
      reason: null,
      plan: planned.plan,
    };
    const chat = createSommelierChatService({
      ask: async () => answer,
      repo: { findExchange: async () => null } as unknown as SommelierChatDeps["repo"],
      record: record as unknown as SommelierChatDeps["record"],
      userId: "u1",
      householdId: async () => "h1",
      social: true,
    });
    const reply = await chat.ask({
      messages: [{ role: "user", text: `${QUESTION} with @anna` }],
      questionId: "11111111-1111-4111-8111-111111111111",
    });
    expect(record).not.toHaveBeenCalled();
    expect(reply.saved).toBeNull();
    // An ordinary question is still kept.
    answer.plan = { ...planned.plan, friends: [] };
    await chat.ask({
      messages: [{ role: "user", text: QUESTION }],
      questionId: "22222222-2222-4222-8222-222222222222",
    });
    expect(record).toHaveBeenCalledTimes(1);
  });
});
