import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DomainError,
  type AskSommelier,
  type CellarItem,
  type RawSommelier,
  type SommelierAnswer,
  parseSommelierParts,
} from "@cellr/domain";
import type { AiErrorKind, GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import { createSommelierIntelligence, type Planned } from "../intelligence";
import { createSommelierService } from "../service";
import {
  createSommelierFallback,
  fallbackAnswer,
  FALLBACK_DEADLINE_MS,
  isFactQuestion,
  type FallbackDeps,
  type FallbackInput,
} from "./fallback";

/**
 * THE FALLBACK (P7). The engines answer only where V1 has no model answer, never throw, never wait long, never show
 * a price, and give way to the plain answer wherever they have nothing better.
 */
let n = 0;
const item = (over: Partial<CellarItem> = {}): CellarItem => ({
  vintageId: `${(0x300000 + ++n).toString(16)}aa-0000-4000-8000-000000000000`,
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
const chablis = () => item({});
const barolo = () =>
  item({
    producer: "Cantina Esempio",
    wineName: "Barolo",
    type: "red",
    year: 2016,
    region: "Piedmont",
    appellation: "Barolo",
    countryCode: "IT",
  });

const NOW = new Date("2026-11-19T18:00:00Z");

function engines(items: readonly CellarItem[], buying = false) {
  return createSommelierIntelligence({
    cellar: async () => ({ items: [...items], bottleCount: items.length }),
    profiles: async () => new Map(),
    taste: async () => null,
    offers: null,
    buying,
    now: () => NOW,
  });
}

/** The fallback with counters: how often the engines' limit was spent and how often they were asked. */
function counted(intelligence: FallbackDeps["intelligence"], spend?: () => Promise<void>) {
  const calls = { spent: 0, planned: 0 };
  const fallback = createSommelierFallback({
    intelligence: {
      plan: async (request) => {
        calls.planned += 1;
        return intelligence.plan(request);
      },
    },
    spend: async () => {
      calls.spent += 1;
      await spend?.();
    },
  });
  return { fallback, calls };
}

const input = (
  text: string,
  items: readonly CellarItem[],
  over: Partial<FallbackInput> & { mode?: "chat" | "tonight" } = {},
): FallbackInput => ({
  request: { messages: [{ role: "user", text }], mode: over.mode ?? "chat" },
  items,
  reason: "ai-off",
  personal: true,
  locale: "en",
  ...over,
});

const OYSTERS = "Raw oysters tonight. What should I open?";

describe("what the fallback answers", () => {
  it.each(["ai-off", "ai-down", "limit"] as const)(
    "answers a dish with the engines' plan and says why it is not the AI's (%s)",
    async (reason) => {
      const items = [chablis(), barolo()];
      const { fallback, calls } = counted(engines(items));
      const answer = await fallback(input(OYSTERS, items, { reason }));
      expect(answer).not.toBeNull();
      expect(answer!.reason).toBe(reason);
      expect(answer!.source).toBe("basic");
      expect(answer!.text).toBeNull();
      expect(answer!.basic).toBe("pairing");
      expect(answer!.plan?.kind).toBe("pairing");
      expect(answer!.plan?.outcome).toBe("good");
      expect(answer!.bottles.map((b) => b.vintageId)).toEqual([items[0]!.vintageId]);
      expect(calls).toEqual({ spent: 1, planned: 1 });
    },
  );

  it("never carries a price: no styles, no offers, no buying advice", async () => {
    const items = [barolo()];
    const { fallback } = counted(engines(items));
    const answer = await fallback(input(OYSTERS, items));
    // Nothing in this cellar suits oysters: the honest "none", with the closest wine, and nothing to buy.
    expect(answer?.plan?.outcome).toBe("none");
    expect(answer?.basic).toBe("nothing");
    expect(answer?.bottles).toEqual([]);
    expect(answer?.plan?.styles).toEqual([]);
    expect(answer?.plan?.offers).toEqual([]);
    expect(answer?.plan?.offerCheck).toBe("not-asked");
    expect(answer?.buy).toBeUndefined();
    expect(JSON.stringify(answer)).not.toMatch(/fromEuros|priceCents|€/);
  });

  it("declines a buying plan even from engines wired with buying advice by mistake", async () => {
    const items = [barolo()];
    const wrong = engines(items, true);
    // The engines alone would advise styles with their price bands here.
    const planned = await wrong.plan({
      question: OYSTERS,
      state: undefined,
      budgetEuros: null,
      personal: true,
      locale: "en",
    });
    expect(planned?.plan.styles.length).toBeGreaterThan(0);
    const { fallback } = counted(wrong);
    expect(await fallback(input(OYSTERS, items))).toBeNull();
    expect(
      await fallback(input("I want to buy a red for the lamb, under 20 euros", items)),
    ).toBeNull();
  });

  it("strips styles and offers from a pairing plan that carries them", async () => {
    const items = [chablis()];
    const planned = (await engines(items).plan({
      question: OYSTERS,
      state: undefined,
      budgetEuros: null,
      personal: true,
      locale: "en",
    }))!;
    const tainted: Planned = {
      ...planned,
      plan: {
        ...planned.plan,
        styles: [
          {
            styleId: "muscadet",
            label: "Muscadet",
            type: "white",
            fromEuros: 12,
            reason: "suits-dish",
            pros: [],
          },
        ],
        offerCheck: "shown",
        offers: [
          {
            level: "online-offer",
            producer: "X",
            name: "Y",
            year: 2023,
            sizeMl: 750,
            priceCents: 1299,
            currency: "EUR",
            merchant: "Shop",
            store: null,
            url: "https://shop.example.com/y",
            observedAt: NOW.toISOString(),
          },
        ],
      },
    };
    const answer = fallbackAnswer(tainted, "ai-down", items);
    expect(answer?.plan?.styles).toEqual([]);
    expect(answer?.plan?.offers).toEqual([]);
    expect(answer?.plan?.offerCheck).toBe("not-asked");
    expect(answer?.bottles).toHaveLength(1);
  });

  it("answers Tonight mode as it answers the chat", async () => {
    const items = [chablis(), barolo()];
    const { fallback } = counted(engines(items));
    const tonight = await fallback(input(OYSTERS, items, { mode: "tonight" }));
    const chat = await fallback(input(OYSTERS, items));
    expect(tonight).toEqual(chat);
    expect(tonight?.plan?.kind).toBe("pairing");
  });

  it("leaves an empty cellar to the caller, in the chat and in Tonight mode, without spending", async () => {
    const { fallback, calls } = counted(engines([]));
    expect(await fallback(input(OYSTERS, []))).toBeNull();
    expect(await fallback(input(OYSTERS, [], { mode: "tonight" }))).toBeNull();
    expect(calls).toEqual({ spent: 0, planned: 0 });
  });

  it.each([
    "How many bottles of Chablis do I have?",
    "Where is my Chablis?",
    "Hoeveel flessen heb ik?",
    "Which Burgundy do I have?",
  ])("never takes a question of fact (%s): the counted facts answer it", async (question) => {
    const items = [chablis()];
    const { fallback, calls } = counted(engines(items));
    expect(isFactQuestion(question)).toBe(true);
    expect(await fallback(input(question, items))).toBeNull();
    expect(calls).toEqual({ spent: 0, planned: 0 });
  });

  it("takes 'which wine do I have for the oysters' for what it is: a pairing", async () => {
    const items = [chablis()];
    const question = "Oysters tonight. Which wine do I have for that?";
    expect(isFactQuestion(question)).toBe(false);
    const { fallback } = counted(engines(items));
    expect((await fallback(input(question, items)))?.plan?.outcome).toBe("good");
  });

  it("leaves a general question about wine to the plain answer (the engines decline it)", async () => {
    const items = [chablis()];
    const { fallback, calls } = counted(engines(items));
    expect(
      await fallback(input("What is the difference between Chablis and Meursault?", items)),
    ).toBeNull();
    expect(calls).toEqual({ spent: 1, planned: 1 });
  });

  it("asks back when the question is not about wine or food, with no bottles", async () => {
    const items = [chablis(), barolo()];
    const { fallback } = counted(engines(items));
    const answer = await fallback(input("What's the weather like tomorrow?", items));
    expect(answer?.plan?.kind).toBe("clarify");
    expect(answer?.plan?.ask).toBe("dish");
    expect(answer?.bottles).toEqual([]);
    expect(answer?.basic).toBe("nothing");
    expect(answer?.reason).toBe("ai-off");
  });

  it("gives a question back to the plain answer when asked to (the measured alternative)", async () => {
    const items = [chablis()];
    const fallback = createSommelierFallback(
      { intelligence: engines(items), spend: async () => {} },
      { clarify: "plain" },
    );
    expect(await fallback(input("What's the weather like tomorrow?", items))).toBeNull();
  });

  it("declines a plan that says nothing, or asks only what a buyer is asked", async () => {
    const items = [chablis()];
    const planned = (await engines(items).plan({
      question: "What's the weather like tomorrow?",
      state: undefined,
      budgetEuros: null,
      personal: true,
      locale: "en",
    }))!;
    expect(planned.plan.kind).toBe("clarify");
    for (const ask of [null, "budget", "channel", "location-consent", "recipient-taste"] as const)
      expect(
        fallbackAnswer({ ...planned, plan: { ...planned.plan, ask } }, "ai-off", items),
      ).toBeNull();
    const pairing = (await engines(items).plan({
      question: OYSTERS,
      state: undefined,
      budgetEuros: null,
      personal: true,
      locale: "en",
    }))!;
    const nothing: Planned = {
      ...pairing,
      plan: { ...pairing.plan, outcome: null, picks: [], closest: null, setAside: [] },
      bottles: [],
      otherBottles: [],
    };
    expect(fallbackAnswer(nothing, "ai-off", items)).toBeNull();
  });

  it("never shows a wine that is not in the cellar the caller read", async () => {
    const items = [chablis()];
    const planned = (await engines(items).plan({
      question: OYSTERS,
      state: undefined,
      budgetEuros: null,
      personal: true,
      locale: "en",
    }))!;
    // The engines read another cellar than the caller (a race between two reads): not drawn.
    expect(fallbackAnswer(planned, "ai-off", [barolo()])).toBeNull();
    // A pick without its card.
    expect(fallbackAnswer({ ...planned, bottles: [] }, "ai-off", items)).toBeNull();
    // A plan a kept conversation could not draw again.
    expect(
      fallbackAnswer({ ...planned, plan: { ...planned.plan, v: 2 as never } }, "ai-off", items),
    ).toBeNull();
    expect(fallbackAnswer(null, "ai-off", items)).toBeNull();
  });
});

describe("the fallback is never the person's problem", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when the engines' limit is spent (RATE_LIMITED), without asking them", async () => {
    const items = [chablis()];
    const { fallback, calls } = counted(engines(items), async () => {
      throw new DomainError("RATE_LIMITED");
    });
    expect(await fallback(input(OYSTERS, items))).toBeNull();
    expect(calls).toEqual({ spent: 1, planned: 0 });
  });

  it("returns null when the limit itself cannot be read", async () => {
    const items = [chablis()];
    const { fallback } = counted(engines(items), async () => {
      throw new Error("database down");
    });
    expect(await fallback(input(OYSTERS, items))).toBeNull();
  });

  it("returns null when the engines throw, synchronously or not", async () => {
    const items = [chablis()];
    const rejecting = createSommelierFallback({
      intelligence: { plan: async () => Promise.reject(new Error("engine failed")) },
      spend: async () => {},
    });
    const throwing = createSommelierFallback({
      intelligence: {
        plan: () => {
          throw new Error("engine failed");
        },
      },
      spend: async () => {},
    });
    expect(await rejecting(input(OYSTERS, items))).toBeNull();
    expect(await throwing(input(OYSTERS, items))).toBeNull();
  });

  it("returns null for nonsense the engines return", async () => {
    const items = [chablis()];
    for (const odd of [{}, { plan: null }, { plan: { kind: "pairing" } }, 42])
      expect(
        await createSommelierFallback({
          intelligence: { plan: async () => odd as never },
          spend: async () => {},
        })(input(OYSTERS, items)),
      ).toBeNull();
  });

  it("returns null for a request without a question", async () => {
    const items = [chablis()];
    const { fallback, calls } = counted(engines(items));
    for (const request of [{ messages: [] }, { messages: [{ role: "user", text: "  " }] }, {}])
      expect(
        await fallback({ ...input(OYSTERS, items), request: request as AskSommelier }),
      ).toBeNull();
    expect(calls).toEqual({ spent: 0, planned: 0 });
  });

  it("stops waiting for slow engines at its own short deadline, and ignores their late answer", async () => {
    vi.useFakeTimers();
    const items = [chablis()];
    const real = engines(items);
    let late: Promise<unknown> | null = null;
    const fallback = createSommelierFallback({
      intelligence: {
        plan: (request) =>
          (late = new Promise((resolve) => setTimeout(resolve, 60_000)).then(() =>
            real.plan(request),
          )) as ReturnType<typeof real.plan>,
      },
      spend: async () => {},
    });
    let settled: SommelierAnswer | null | "pending" = "pending";
    const pending = fallback(input(OYSTERS, items)).then((a) => (settled = a));
    await vi.advanceTimersByTimeAsync(FALLBACK_DEADLINE_MS - 1);
    expect(settled).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBeNull();
    // The late plan arrives and changes nothing.
    await vi.advanceTimersByTimeAsync(60_000);
    await late;
    expect(settled).toBeNull();
  });

  it("does not leave a late failure unhandled", async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const record = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", record);
    try {
      const fallback = createSommelierFallback(
        {
          intelligence: {
            plan: () =>
              new Promise((_, reject) => setTimeout(() => reject(new Error("late")), 5_000)),
          },
          spend: async () => {},
        },
        { deadlineMs: 100 },
      );
      const pending = fallback(input(OYSTERS, [chablis()]));
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toBeNull();
      await vi.advanceTimersByTimeAsync(5_000);
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });

  it("keeps the deadline short: it never stands in for a general timeout", () => {
    expect(FALLBACK_DEADLINE_MS).toBeLessThanOrEqual(2_000);
  });
});

/**
 * The service with the part on: where it answered with plain() it first asks the fallback, with the same reason;
 * anywhere else the fallback is not asked.
 */
describe("only when V1 has no model answer", () => {
  const MODEL: RawSommelier = {
    answer: "Open the Chablis.",
    bottle_refs: [],
    verdict: "match",
    buy: [],
    used_taste: false,
  };

  function world(
    options: {
      items?: CellarItem[];
      model?: "answers" | AiErrorKind | "none";
      chatSpend?: () => Promise<void>;
      sommelierEngine?: boolean;
      /** false: CELLR_SOMMELIER does not name `fallback` (the dependency is there, the part is off). */
      part?: boolean;
      /** The parts CELLR_SOMMELIER names, when a test needs more than `fallback`. */
      parts?: string;
      /** The model answers with words that are empty once cleaned: V1 does not show such an answer. */
      emptyAnswer?: boolean;
    } = {},
  ) {
    const items = options.items ?? [chablis(), barolo()];
    const state = { modelCalls: 0 };
    const llm: LlmProvider = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        state.modelCalls += 1;
        const usage = { model: "chat-model", tokensIn: 1, tokensOut: 1, latencyMs: 1 };
        if (options.model && options.model !== "answers" && options.model !== "none")
          return { ok: false as const, kind: options.model, usage };
        return {
          ok: true as const,
          value: request.parse(options.emptyAnswer ? { ...MODEL, answer: " \n " } : MODEL),
          usage,
        };
      },
    };
    const cellar = async () => ({ items, bottleCount: items.length });
    const { fallback, calls } = counted(engines(items));
    // The service as the composition root builds it with CELLR_SOMMELIER=fallback.
    const service = createSommelierService({
      ...(options.sommelierEngine ? { intelligence: engines(items, true) } : {}),
      parts: parseSommelierParts(options.parts ?? (options.part === false ? "" : "fallback")),
      fallback,
      cellar,
      storage: async () => [],
      racks: async () => ({ units: [], unplaced: [] }),
      tonight: async (request) => ({
        dish: request.dish,
        occasion: request.occasion,
        picks: [],
        considered: 0,
      }),
      llm: options.model === "none" ? null : llm,
      spend: options.chatSpend ?? (async () => {}),
      householdId: async () => "h1",
      locale: async () => "en",
      recordUsage: async () => {},
    });
    const ask = (text: string): Promise<SommelierAnswer> =>
      service.ask({ messages: [{ role: "user" as const, text }] });
    return { ask, state, calls };
  }

  it("never consults the engines when the model answers", async () => {
    const { ask, state, calls } = world({ model: "answers" });
    const answer = await ask(OYSTERS);
    expect(answer.source).toBe("ai");
    expect(answer.plan ?? null).toBeNull();
    expect(state.modelCalls).toBe(1);
    expect(calls).toEqual({ spent: 0, planned: 0 });
  });

  it("answers with the engines when no model is configured (no key)", async () => {
    const { ask, state } = world({ model: "none" });
    const answer = await ask(OYSTERS);
    expect(answer.reason).toBe("ai-off");
    expect(answer.plan?.outcome).toBe("good");
    expect(state.modelCalls).toBe(0);
  });

  it("answers with the engines when the person's chat limit is spent (RATE_LIMITED)", async () => {
    const { ask, state } = world({
      chatSpend: async () => {
        throw new DomainError("RATE_LIMITED");
      },
    });
    const answer = await ask(OYSTERS);
    expect(answer.reason).toBe("limit");
    expect(answer.plan?.outcome).toBe("good");
    expect(state.modelCalls).toBe(0);
  });

  it.each([
    ["unavailable", "ai-down"],
    ["refused", "ai-down"],
    ["timeout", "ai-down"],
    ["invalid", "ai-down"],
    ["rate_limited", "ai-down"],
    ["budget", "limit"],
  ] as const)(
    "answers with the engines when the provider fails (%s), with one model call only",
    async (kind, reason) => {
      const { ask, state, calls } = world({ model: kind });
      const answer = await ask(OYSTERS);
      expect(answer.reason).toBe(reason);
      expect(answer.source).toBe("basic");
      expect(answer.plan?.outcome).toBe("good");
      expect(state.modelCalls).toBe(1);
      expect(calls).toEqual({ spent: 1, planned: 1 });
    },
  );

  it("keeps the counted facts for a question of fact when there is no model", async () => {
    const { ask, calls } = world({ model: "none" });
    const answer = await ask("How many bottles of Chablis do I have?");
    expect(answer.basic).toBe("facts");
    expect(calls).toEqual({ spent: 0, planned: 0 });
  });

  it("with sommelier_engine on, the engines answer first and the fallback is never reached", async () => {
    const { ask, state, calls } = world({ model: "unavailable", sommelierEngine: true });
    const answer = await ask(OYSTERS);
    expect(answer.reason).toBeNull();
    expect(answer.plan?.outcome).toBe("good");
    expect(state.modelCalls).toBe(0);
    expect(calls).toEqual({ spent: 0, planned: 0 });
  });

  it("with sommelier_engine on, a question they declined is not put to them again: one answer, the plain one", async () => {
    const { ask, state, calls } = world({ model: "unavailable", sommelierEngine: true });
    const answer = await ask("What is the difference between Chablis and Meursault?");
    expect(state.modelCalls).toBe(1);
    expect(answer.reason).toBe("ai-down");
    expect(answer.plan ?? null).toBeNull();
    expect(calls).toEqual({ spent: 0, planned: 0 });
  });

  it("with the part off the engines are never asked, whatever happens to the model", async () => {
    for (const model of ["none", "unavailable", "answers"] as const) {
      const { ask, calls } = world({ model, part: false });
      const answer = await ask(OYSTERS);
      expect(answer.plan ?? null).toBeNull();
      expect(calls).toEqual({ spent: 0, planned: 0 });
    }
  });

  it("'which wine do I have for the oysters' is a pairing for the engines when there is no model", async () => {
    const { ask, calls } = world({ model: "none" });
    const answer = await ask("Which wine do I have for the oysters?");
    expect(answer.basic).not.toBe("facts");
    expect(answer.plan?.outcome).toBe("good");
    expect(answer.reason).toBe("ai-off");
    expect(calls).toEqual({ spent: 1, planned: 1 });
  });

  it("an answer of the model that does not pass its check is the engines' too", async () => {
    const { ask, state } = world({ model: "answers", emptyAnswer: true });
    const answer = await ask(OYSTERS);
    expect(state.modelCalls).toBe(1);
    expect(answer.reason).toBe("ai-down");
    expect(answer.plan?.outcome).toBe("good");
  });

  it("with `check` on as well: a model that answers is checked and never the engines'; a model that is down is the engines', unchecked", async () => {
    const up = world({ model: "answers", parts: "check,fallback" });
    const answered = await up.ask(OYSTERS);
    expect(answered.source).toBe("ai");
    expect(answered.check).toEqual({ v: 1, text: "kept", codes: [] });
    expect(answered.plan ?? null).toBeNull();
    expect(up.calls).toEqual({ spent: 0, planned: 0 });

    const down = world({ model: "unavailable", parts: "check,fallback" });
    const planned = await down.ask(OYSTERS);
    expect(planned.reason).toBe("ai-down");
    expect(planned.plan?.outcome).toBe("good");
    expect(planned).not.toHaveProperty("check");
    expect(down.state.modelCalls).toBe(1);
  });
});
