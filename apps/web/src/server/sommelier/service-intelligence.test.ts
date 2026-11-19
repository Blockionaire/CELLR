import { describe, expect, it } from "vitest";
import type { CellarItem, RawSommelier } from "@cellr/domain";
import type { GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import { createSommelierIntelligence, type SommelierIntelligence } from "./intelligence";
import { createSommelierService } from "./service";

/**
 * THE SWITCH. With the engines absent the sommelier answers exactly as before; with them present they answer what
 * they decide themselves (no model, nothing spent) and everything else still goes the old way, with the model's
 * own verdict and buying advice dropped.
 */
let n = 0;
const item = (over: Partial<CellarItem>): CellarItem => ({
  vintageId: `${(0x200000 + ++n).toString(16)}aa-0000-4000-8000-000000000000`,
  wineId: `w${n}`,
  producer: "Domaine Exemple",
  wineName: "Chablis",
  type: "white",
  year: 2022,
  region: "Burgundy",
  appellation: "Chablis",
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
  ...over,
});

const MODEL: RawSommelier = {
  answer: "Open the Chablis.",
  bottle_refs: [],
  verdict: "match",
  buy: [{ wine: "Some Sancerre", why: "fresh", price: "about €20" }],
  used_taste: false,
};

function setup(engine: "on" | "off" | "broken", items: CellarItem[] = [item({})]) {
  const state = { modelCalls: 0, spent: 0 };
  const cellar = async () => ({ items, bottleCount: items.reduce((s, i) => s + i.count, 0) });
  const llm = {
    async generateObject<T>(request: GenerateObjectRequest<T>) {
      state.modelCalls += 1;
      return {
        ok: true as const,
        value: request.parse(MODEL),
        usage: { model: "test", inputTokens: 1, outputTokens: 1, usdMicro: 1, servedModel: null },
      };
    },
  } as unknown as LlmProvider;
  const real = createSommelierIntelligence({
    cellar,
    profiles: async () => new Map(),
    taste: async () => null,
    offers: null,
    buying: true,
    now: () => new Date("2026-11-19T18:00:00Z"),
  });
  const broken: SommelierIntelligence = {
    readsDish: () => true,
    plan: async () => {
      throw new Error("engine failed");
    },
  };
  const service = createSommelierService({
    ...(engine === "off" ? {} : { intelligence: engine === "on" ? real : broken }),
    cellar,
    storage: async () => [],
    racks: async () => ({ units: [], unplaced: [] }),
    tonight: async (request) => ({
      dish: request.dish,
      occasion: request.occasion,
      picks: [],
      considered: 0,
    }),
    llm,
    spend: async () => {
      state.spent += 1;
    },
    householdId: async () => "h1",
    locale: async () => "en",
    recordUsage: async () => {},
  });
  const ask = (text: string, more: { state?: unknown } = {}) =>
    service.ask({ messages: [{ role: "user", text }], ...more });
  return { ask, state };
}

describe("the sommelier with the engines switched on", () => {
  it("answers a dish from the engines: a plan, no model, nothing spent", async () => {
    const { ask, state } = setup("on");
    const answer = await ask("Raw oysters tonight. What should I open?");
    expect(answer.plan?.outcome).toBe("good");
    expect(answer.source).toBe("basic");
    expect(answer.basic).toBe("pairing");
    expect(answer.bottles).toHaveLength(1);
    expect(answer.reason).toBeNull();
    expect(state).toEqual({ modelCalls: 0, spent: 0 });
  });

  it("keeps the old shape when nothing suits, so a screen that knows no plans still draws it", async () => {
    const { ask } = setup("on", [
      item({ wineName: "Pauillac", type: "red", appellation: "Pauillac", region: "Bordeaux" }),
    ]);
    const answer = await ask("Raw oysters tonight. What should I open?");
    expect(answer.plan?.outcome).toBe("none");
    expect(answer.basic).toBe("nothing");
    expect(answer.text).toBeNull();
  });

  it("leaves questions of fact to the counted facts", async () => {
    const { ask, state } = setup("on");
    const answer = await ask("How many bottles of Chablis do I have?");
    // The old path, unchanged: the counted facts go to the model to be worded (or are shown plainly without one).
    expect(answer.plan ?? null).toBeNull();
    expect(state).toEqual({ modelCalls: 1, spent: 1 });
  });

  it("takes 'which wine do I have for the oysters' for what it is: a pairing", async () => {
    const { ask, state } = setup("on");
    const answer = await ask("Oysters tonight. Which wine do I have for that?");
    expect(answer.plan?.kind).toBe("pairing");
    expect(answer.plan?.outcome).toBe("good");
    expect(state.modelCalls).toBe(0);
  });

  it("sends a general question about wine to the model, and drops the model's own verdict and buying advice", async () => {
    const { ask, state } = setup("on");
    const answer = await ask("Tell me something about Chablis as a wine");
    expect(state.modelCalls).toBe(1);
    expect(answer.source).toBe("ai");
    expect(answer.plan ?? null).toBeNull();
    expect(answer.verdict).toBeNull();
    expect(answer.buy).toEqual([]);
  });

  it("carries the conversation's state from one answer to the next question", async () => {
    const { ask } = setup("on", []);
    const first = await ask("What should I buy for sea bass?");
    expect(first.plan?.ask).toBe("budget");
    const second = await ask("€25.", { state: first.plan?.state });
    expect(second.plan?.state).toMatchObject({ dish: "sea bass", budgetMaxEuros: 25 });
  });

  it("falls back to the old answer when the engines fail: never an error where an answer can be given", async () => {
    const { ask, state } = setup("broken");
    const answer = await ask("Raw oysters tonight. What should I open?");
    expect(answer.plan ?? null).toBeNull();
    expect(answer.source).toBe("ai");
    expect(state.modelCalls).toBe(1);
  });
});

describe("the sommelier with the engines switched off", () => {
  it("answers exactly as before: the model, its verdict and its buying advice", async () => {
    const { ask, state } = setup("off");
    const answer = await ask("Raw oysters tonight. What should I open?");
    expect(state).toEqual({ modelCalls: 1, spent: 1 });
    expect(answer.source).toBe("ai");
    expect(answer.plan).toBeUndefined();
    expect(answer.verdict).toBe("match");
    expect(answer.buy).toHaveLength(1);
  });
});
