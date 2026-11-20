import { describe, expect, it, vi } from "vitest";
import { DomainError, SommelierPlanSchema, type CellarItem } from "@cellr/domain";
import {
  FOOD,
  type DishReading,
  type PairingReview,
  type ReviewInput,
} from "@cellr/domain/intelligence";
import type { AiResult, GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import { createMemoryDishCache, dishCacheKey } from "./dish-cache";
import { createDishReader } from "./dish-reader";
import { createSommelierIntelligence } from "./intelligence";

/**
 * A MODEL READS THE DISH THE PARSER CANNOT (S10). These tests hold the engines to their side of it: the model is
 * asked only when the parser shows it may have misread the dish, with the dish phrase and nothing else; never for
 * a question that names a friend; any failure leaves the parser's reading; a model reading never sounds sure; and
 * the model never names a wine. No real model is called.
 */
let n = 0;
const item = (wineName: string, type: CellarItem["type"], appellation: string): CellarItem => ({
  vintageId: `${(0x700000 + ++n).toString(16)}aa-0000-4000-8000-000000000000`,
  wineId: `w${n}`,
  producer: "Domaine Exemple",
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
    reliable: true,
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
const CELLAR = [
  item("Riesling Kabinett", "white", "Mosel"),
  item("Côtes du Rhône", "red", "Côtes du Rhône"),
  item("Chablis", "white", "Chablis"),
];
const pork = FOOD.ingredients.find((i) => i.main === "pork")!.id;
const PORK: DishReading = {
  recognised: true,
  main: "pork",
  mainIngredient: pork,
  ingredients: [],
  techniques: [],
  sauces: [],
  structure: { weight: 4, fat: 2, salt: 2, acid: 2 },
  tags: [],
  confidence: "high",
  dropped: 0,
};

function setupRaw(reading: DishReading | null | "throws" = PORK, social = false) {
  const asked: string[] = [];
  const lookups: Array<{ phrase: string; cacheOnly: boolean }> = [];
  const seen: Array<{ main: string | null; readBy: string | undefined }> = [];
  const intelligence = createSommelierIntelligence({
    cellar: async () => ({ items: CELLAR, bottleCount: 6 }),
    profiles: async () => new Map(),
    taste: async () => null,
    offers: null,
    buying: true,
    ...(social
      ? {
          friends: async (handles: readonly string[]) =>
            handles.map((handle) => ({ handle, status: "included" as const, taste: null })),
        }
      : {}),
    readDish: async (phrase, options) => {
      lookups.push({ phrase, cacheOnly: options?.cacheOnly === true });
      // `asked` plays the shared store: what was read before is not read again.
      if (asked.includes(phrase)) return reading === "throws" ? null : reading;
      if (options?.cacheOnly) return null;
      asked.push(phrase);
      if (reading === "throws") throw new Error("down");
      return reading;
    },
    observe: ({ food }) => seen.push({ main: food?.main ?? null, readBy: food?.readBy }),
    now: () => new Date("2026-11-20T18:00:00Z"),
  });
  return { intelligence, asked, seen, lookups };
}
function setup(reading: DishReading | null | "throws" = PORK, social = false) {
  const raw = setupRaw(reading, social);
  const ask = (question: string, state?: unknown) =>
    raw.intelligence.plan({ question, state, budgetEuros: null, personal: true, locale: "en" });
  return { ...raw, ask };
}

describe("when the model is asked", () => {
  it("not for a dish the parser knows in full", async () => {
    const { ask, asked } = setup();
    const planned = await ask("What do I open with roast lamb?");
    expect(asked).toEqual([]);
    expect(planned!.plan.dish).toBeTruthy();
  });

  it("for a dish it could not place, with the dish phrase alone", async () => {
    const { ask, asked, seen } = setup();
    const planned = await ask(
      "Zuurkool met casselerrib vanavond voor mijn schoonouders, max 20 euro?",
    );
    expect(asked).toEqual(["zuurkool met casselerrib"]);
    expect(seen.at(-1)).toEqual({ main: "pork", readBy: "model" });
    expect(SommelierPlanSchema.safeParse(planned!.plan).success).toBe(true);
  });

  it("never for a question that names a friend, not even its dish", async () => {
    const { ask, asked } = setup(PORK, true);
    await ask("@thomas komt, we eten zuurkool met casselerrib. Welke wijn?");
    expect(asked).toEqual([]);
  });

  it("an answer built on a model's reading never sounds sure", async () => {
    const { ask } = setup();
    const planned = await ask("Zuurkool met casselerrib, welke wijn?");
    expect(planned!.plan.dishConfidence).not.toBe("high");
    expect(planned!.plan.confidence).not.toBe("high");
  });
});

describe("what never goes to a model (S10 review)", () => {
  it.each([
    "@ anna eet zuurkool met casselerrib, welke wijn?",
    "anna@ komt, zuurkool met casselerrib, welke wijn?",
    "anna.bakker@gmail.com komt eten: zuurkool met casselerrib, welke wijn?",
    "@аnna komt, zuurkool met casselerrib, welke wijn?",
  ])("a question with any '@' in it, social on or off: %s", async (question) => {
    for (const social of [false, true]) {
      const { ask, asked } = setup(PORK, social);
      await ask(question);
      expect(asked, String(social)).toEqual([]);
    }
  });

  it("a conversation that named someone earlier, even when this question does not", async () => {
    const { intelligence, asked } = setupRaw();
    await intelligence.plan({
      question: "En met zuurkool en casselerrib dan?",
      state: undefined,
      budgetEuros: null,
      personal: true,
      locale: "en",
      earlier: ["@anna komt eten, wat drinken we?"],
    });
    expect(asked).toEqual([]);
  });

  it("a follow-up's dish is the stored reading of the phrase already read: nothing new is sent", async () => {
    const { ask, asked, lookups } = setup();
    const first = await ask("Zuurkool met casselerrib, welke wijn?");
    expect(asked).toEqual(["zuurkool met casselerrib"]);
    const next = await ask("En iets goedkopers?", first!.plan.state);
    expect(asked).toEqual(["zuurkool met casselerrib"]);
    // The phrase a model already read, found in the store: nothing new is sent.
    expect(lookups.at(-1)?.phrase).toBe("zuurkool met casselerrib");
    // The same dish as the first turn: the stored reading of the phrase that was read.
    expect(next!.plan.dish).toBe("zuurkool met casselerrib");
  });

  it("a follow-up whose stored reading is gone asks again only for a dish a model has already seen", async () => {
    // Another server instance: nothing stored.
    const { intelligence, asked, lookups } = setupRaw();
    const plan = (question: string, state?: unknown) =>
      intelligence.plan({ question, state, budgetEuros: null, personal: true, locale: "en" });
    const first = await plan("Zuurkool met casselerrib, welke wijn?");
    expect(first!.plan.state.dishReadByModel).toBe(true);
    asked.length = 0;
    const next = await plan("En iets goedkopers?", { ...first!.plan.state });
    // The lookup may call again, for the phrase a model already read: the dish stays pork.
    expect(lookups.at(-1)).toEqual({ phrase: "zuurkool met casselerrib", cacheOnly: false });
    expect(next!.plan.dish).toBe("zuurkool met casselerrib");
  });

  it("a dish no model has seen (a question that named someone) is never sent by a follow-up", async () => {
    const { intelligence, asked } = setupRaw();
    const plan = (question: string, state?: unknown) =>
      intelligence.plan({ question, state, budgetEuros: null, personal: true, locale: "en" });
    const first = await plan("@anna komt, zuurkool met casselerrib, welke wijn?");
    expect(first!.plan.state.dishReadByModel).toBe(false);
    // Many turns later, the turn with the name is no longer sent along.
    await plan("En iets goedkopers?", first!.plan.state);
    expect(asked).toEqual([]);
  });

  it.each([
    "Is my Barolo 2016 ready to drink?",
    "Tell me about Riesling",
    "What should I cook with my Barolo?",
    "Oysters to start, then roast lamb, then cheese: which wines?",
    "I feel sad today, my mother died",
    "asdf qwerty",
  ])("a question that is not about a dish to pair: %s", async (question) => {
    const { ask, asked } = setup();
    await ask(question);
    expect(asked).toEqual([]);
  });
});

describe("when the model fails or does not know", () => {
  it.each([
    ["down", "throws" as const],
    ["no answer", null],
    ["not recognised", { recognised: false } as DishReading],
  ])("%s: the parser's reading, as without the switch", async (_, reading) => {
    const plain = createSommelierIntelligence({
      cellar: async () => ({ items: CELLAR, bottleCount: 6 }),
      profiles: async () => new Map(),
      taste: async () => null,
      offers: null,
      buying: true,
      now: () => new Date("2026-11-20T18:00:00Z"),
    });
    const question = "Zuurkool met casselerrib, welke wijn?";
    const without = await plain.plan({
      question,
      state: undefined,
      budgetEuros: null,
      personal: true,
      locale: "en",
    });
    const { ask } = setup(reading);
    const withIt = await ask(question);
    expect(withIt?.plan.outcome).toBe(without?.plan.outcome);
    expect(withIt?.bottles.map((b) => b.vintageId)).toEqual(
      without?.bottles.map((b) => b.vintageId),
    );
  });
});

describe("the dish reader", () => {
  const request = vi.fn();
  function provider(answer: AiResult<DishReading> | "count"): LlmProvider {
    return {
      async generateObject<T>(r: GenerateObjectRequest<T>): Promise<AiResult<T>> {
        request(r);
        return answer as unknown as AiResult<T>;
      },
    };
  }
  const usage = { model: "m", tokensIn: 10, tokensOut: 5, latencyMs: 1, reported: true };
  const deps = (llm: LlmProvider, cache = createMemoryDishCache()) => ({
    llm,
    model: "m",
    spend: async () => {},
    householdId: async () => "h1",
    recordUsage: vi.fn(async () => {}),
    cache,
  });

  it("asks once with the phrase alone, records the usage, and the next person's question is free", async () => {
    request.mockClear();
    const d = deps(provider({ ok: true, value: PORK, usage }));
    const read = createDishReader(d);
    expect(await read("zuurkool met casselerrib")).toEqual(PORK);
    expect(await read("zuurkool met casselerrib")).toEqual(PORK);
    expect(request).toHaveBeenCalledTimes(1);
    const sent = request.mock.calls[0]![0] as GenerateObjectRequest<unknown>;
    expect(sent.task).toBe("dish_reading");
    expect(sent.user).toBe('Dish: "zuurkool met casselerrib"');
    expect(d.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ task: "dish_reading", status: "ok" }),
    );
  });

  it("a follow-up's lookup never calls the model", async () => {
    request.mockClear();
    const read = createDishReader(deps(provider({ ok: true, value: PORK, usage })));
    expect(await read("bulgogi", { cacheOnly: true })).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(await read("bulgogi")).toEqual(PORK);
    expect(await read("bulgogi", { cacheOnly: true })).toEqual(PORK);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("a failure is null, recorded, and not kept", async () => {
    request.mockClear();
    const d = deps(provider({ ok: false, kind: "budget", usage }));
    const read = createDishReader(d);
    expect(await read("bulgogi")).toBeNull();
    expect(await read("bulgogi")).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
    expect(d.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "budget_exhausted" }),
    );
  });

  it("the person's limit gone: null, and no call", async () => {
    request.mockClear();
    const read = createDishReader({
      ...deps(provider({ ok: true, value: PORK, usage })),
      spend: async () => {
        throw new DomainError("RATE_LIMITED", "slow down");
      },
    });
    expect(await read("bulgogi")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});

describe("the shared store of dish readings", () => {
  it("keys on a hash of the phrase and every version; never the phrase itself", () => {
    const key = dishCacheKey("zuurkool met casselerrib", "gpt-6-luna", "dish_reading@v1");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toBe(dishCacheKey("zuurkool met casselerrib", "gpt-7", "dish_reading@v1"));
    expect(key).not.toBe(dishCacheKey("zuurkool met casselerrib", "gpt-6-luna", "dish_reading@v2"));
    expect(key).not.toBe(dishCacheKey("zuurkool met kassler", "gpt-6-luna", "dish_reading@v1"));
  });

  it("keeps only the checked fields: anything else on the object is not stored", () => {
    const cache = createMemoryDishCache();
    cache.set("k", { ...PORK, note: "for @jan's birthday" } as unknown as DishReading);
    expect(JSON.stringify(cache.get("k"))).not.toMatch(/jan|birthday/);
    cache.set("bad", { ...PORK, structure: { heat: 9 } } as DishReading);
    expect(cache.get("bad")).toBeNull();
  });

  it("forgets after its time, an unknown dish sooner, and the oldest first when full", () => {
    let now = 0;
    const cache = createMemoryDishCache({ now: () => now, maxEntries: 2 });
    cache.set("a", PORK);
    cache.set("u", { recognised: false });
    now = 25 * 3600 * 1000;
    expect(cache.get("u")).toBeNull();
    expect(cache.get("a")).toEqual(PORK);
    now = 31 * 24 * 3600 * 1000;
    expect(cache.get("a")).toBeNull();
    cache.set("1", PORK);
    cache.set("2", PORK);
    cache.set("3", PORK);
    expect(cache.get("1")).toBeNull();
    expect(cache.get("3")).toEqual(PORK);
  });
});

describe("a second opinion in a close call (variant D)", () => {
  const MORE = [
    ...CELLAR,
    item("Muscadet Sèvre et Maine", "white", "Muscadet Sèvre et Maine"),
    item("Sancerre", "white", "Sancerre"),
    item("Albariño", "white", "Rías Baixas"),
  ];
  const fish = FOOD.ingredients.find((i) => i.main === "white-fish")!.id;
  const FISH: DishReading = {
    ...PORK,
    main: "white-fish",
    mainIngredient: fish,
    structure: { weight: 2, intensity: 2, fat: 1, acid: 1, salt: 1 },
  };
  function withReview(review: PairingReview | null | "throws", friends = false) {
    const seen: ReviewInput[] = [];
    const intelligence = createSommelierIntelligence({
      cellar: async () => ({ items: MORE, bottleCount: 10 }),
      profiles: async () => new Map(),
      taste: async () => null,
      offers: null,
      buying: true,
      ...(friends
        ? {
            friends: async (handles: readonly string[]) =>
              handles.map((handle) => ({ handle, status: "included" as const, taste: null })),
          }
        : {}),
      readDish: async () => FISH,
      secondOpinion: async (input) => {
        seen.push(input);
        if (review === "throws") throw new Error("down");
        return review;
      },
      now: () => new Date("2026-11-20T18:00:00Z"),
    });
    const ask = (question: string) =>
      intelligence.plan({
        question,
        state: undefined,
        budgetEuros: null,
        personal: true,
        locale: "en",
      });
    return { ask, seen };
  }
  // A dish read by the model is always a close call.
  const Q = "Zuurkool met casselerrib, welke wijn?";

  it("sees the dish and the picks as styles: no producer, no wine name, no household", async () => {
    const { ask, seen } = withReview({ keep: ["c1"], reason: "agree" });
    await ask(Q);
    expect(seen).toHaveLength(1);
    const sent = JSON.stringify(seen[0]);
    expect(sent).not.toMatch(/Domaine Exemple|vintageId|Rack|household/);
    expect(seen[0]!.dish.readBy).toBe("model");
  });

  it("can reorder and leave out, never add", async () => {
    const base = await withReview(null).ask(Q);
    const ids = base!.bottles.map((b) => b.vintageId);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const { ask } = withReview({ keep: ["c2"], reason: "better-first" });
    const reviewed = await ask(Q);
    expect(reviewed!.bottles.map((b) => b.vintageId)).toEqual([ids[1]]);
    for (const b of reviewed!.bottles) expect(ids).toContain(b.vintageId);
  });

  it("'none suits' is said as none, and nothing is offered", async () => {
    const reviewed = await withReview({ keep: [], reason: "nothing-suits" }).ask(Q);
    expect(reviewed!.plan.outcome).toBe("none");
    expect(reviewed!.bottles).toEqual([]);
  });

  it("a failed second opinion leaves the engine's picks", async () => {
    const base = await withReview(null).ask(Q);
    const failed = await withReview("throws").ask(Q);
    expect(failed!.bottles.map((b) => b.vintageId)).toEqual(base!.bottles.map((b) => b.vintageId));
  });

  it("never for a question that names a friend", async () => {
    const { ask, seen } = withReview({ keep: [], reason: "nothing-suits" }, true);
    await ask("@thomas komt, zuurkool met casselerrib, welke wijn?");
    expect(seen).toEqual([]);
  });
});
