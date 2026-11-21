import { describe, expect, it } from "vitest";
import type { CellarItem, RawSommelier } from "@cellr/domain";
import type { GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import { createSommelierIntelligence, type SommelierIntelligence } from "./intelligence";
import { createSommelierService } from "./service";

/**
 * NO MODEL EVER SEES A FRIEND'S NAME. With the social sommelier on, a question that names someone is answered by
 * the engines or by the counted facts, or not at all; and a name in an earlier turn is taken out before anything
 * is sent. An independent security review found three ways a name reached the model; each is a test here.
 */
const item = (): CellarItem => ({
  vintageId: "5aaaaaaa-0000-4000-8000-000000000001",
  wineId: "w1",
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
});
const MODEL: RawSommelier = {
  answer: "Here is an answer.",
  bottle_refs: [],
  verdict: "not_pairing",
  buy: [],
  used_taste: false,
};

function setup(options: { social?: boolean; engine?: "real" | "throws" } = {}) {
  const prompts: string[] = [];
  const lookups: string[][] = [];
  const cellar = async () => ({ items: [item()], bottleCount: 2 });
  const llm = {
    async generateObject<T>(request: GenerateObjectRequest<T>) {
      prompts.push(`${request.system}\n${request.user}`);
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
    ...(options.social === false
      ? {}
      : {
          friends: async (handles: readonly string[]) => {
            lookups.push([...handles]);
            return handles.map((handle) => ({
              handle,
              status: "unavailable" as const,
              taste: null,
            }));
          },
        }),
  });
  const throwing: SommelierIntelligence = {
    ...real,
    plan: async () => {
      throw new Error("engine failed");
    },
  };
  const service = createSommelierService({
    intelligence: options.engine === "throws" ? throwing : real,
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
    spend: async () => {},
    householdId: async () => "h1",
    locale: async () => "en",
    recordUsage: async () => {},
  });
  return { service, prompts, lookups };
}
const turns = (...texts: string[]) => ({
  messages: texts.map((text, i) => ({
    role: (i % 2 === (texts.length - 1) % 2 ? "user" : "assistant") as "user" | "assistant",
    text,
  })),
});
const seenByModel = (prompts: string[]) => prompts.join("\n");

describe("a question that names a friend never reaches a model", () => {
  it.each([
    "How many bottles do I have for @anna tonight?",
    "Where is the Chablis? @anna wants it",
    "Do I have a Barolo for @anna?",
    "Tell me about wine, @anna asked",
    "What does @anna like?",
  ])("%s", async (question) => {
    const { service, prompts } = setup();
    const answer = await service.ask(turns(question));
    expect(prompts).toEqual([]);
    expect(answer.source).toBe("basic");
  });

  it("answers a question of fact from the counted facts, without the name", async () => {
    const { service, prompts } = setup();
    const answer = await service.ask(turns("How many bottles of Chablis do I have for @anna?"));
    expect(prompts).toEqual([]);
    expect(answer.basic).toBe("facts");
    expect(answer.facts?.matchedBottles).toBe(2);
    expect(JSON.stringify(answer)).not.toContain("anna");
  });

  it("gives no answer rather than a model's when the engines fail", async () => {
    const { service, prompts } = setup({ engine: "throws" });
    const answer = await service.ask(turns("@anna is coming, steak tonight"));
    expect(prompts).toEqual([]);
    expect(answer).toMatchObject({ source: "basic", basic: "nothing", bottles: [] });
  });

  it("also in Tonight's mode", async () => {
    const { service, prompts } = setup({ engine: "throws" });
    await service.ask({ ...turns("Dinner with @anna, what do we drink?"), mode: "tonight" });
    expect(prompts).toEqual([]);
  });
});

describe("a name in an earlier turn is not sent along", () => {
  it("takes it out of the conversation the model hears", async () => {
    const { service, prompts } = setup();
    await service.ask(
      turns(
        "@anna is coming, steak tonight",
        "Open this for @anna.",
        "Tell me about Barolo in general",
      ),
    );
    expect(prompts).toHaveLength(1);
    expect(seenByModel(prompts)).not.toMatch(/anna|@/);
    expect(seenByModel(prompts)).toContain("Barolo in general");
    // Not the question that was about a friend either, nor the answer to it: with the name gone it is still
    // a question about them.
    expect(seenByModel(prompts)).not.toContain("steak tonight");
    expect(seenByModel(prompts)).not.toContain("Open this for");
  });

  it("takes out anything that looks like a name, valid or not", async () => {
    const { service, prompts } = setup();
    await service.ask(
      turns(
        "x.@anna and @@bram and ＠carla and @аnna came",
        "Noted.",
        "Tell me about Barolo in general",
      ),
    );
    expect(seenByModel(prompts)).not.toMatch(/anna|bram|carla|@|＠|аnna/);
  });
});

describe("with the social sommelier switched off", () => {
  it("the sommelier is as it was: a name is the person's own text", async () => {
    const { service, prompts, lookups } = setup({ social: false });
    await service.ask(turns("Tell me about Barolo, @anna asked"));
    expect(lookups).toEqual([]);
    expect(prompts).toHaveLength(1);
    expect(seenByModel(prompts)).toContain("@anna");
  });
});

describe("a follow-up is still about the friend the conversation named", () => {
  const FIRST = "@anna is coming, steak tonight. What do I open?";

  it("looks the friend up again for a follow-up that names nobody, from the asker's own earlier question", async () => {
    const { service, lookups, prompts } = setup();
    const first = await service.ask(turns(FIRST));
    const next = await service.ask({
      ...turns(FIRST, "Open this.", "And with grilled sea bass?"),
      state: first.plan!.state,
    });
    expect(lookups).toEqual([["anna"], ["anna"]]);
    expect(next.plan?.friends).toEqual([{ handle: "anna", status: "unavailable" }]);
    expect(prompts).toEqual([]);
  });

  it("reads no name from an answer the screen sends back, only from what the person asked", async () => {
    const { service, lookups } = setup();
    const first = await service.ask(turns("Steak tonight. What do I open?"));
    await service.ask({
      ...turns("Steak tonight. What do I open?", "Ask @bram.", "And with grilled sea bass?"),
      state: first.plan!.state,
    });
    expect(lookups).toEqual([]);
  });

  it("with the social sommelier off, earlier questions are not read for names at all", async () => {
    const { service, lookups } = setup({ social: false });
    const first = await service.ask(turns("Steak tonight. What do I open?"));
    await service.ask({
      ...turns(FIRST, "Open this.", "And with grilled sea bass?"),
      state: first.plan!.state,
    });
    expect(lookups).toEqual([]);
  });
});
