import { describe, expect, it } from "vitest";
import {
  AnalyticsPropsSchema,
  TONIGHT_SLOTS,
  type CellarItem,
  type TonightView,
} from "@cellr/domain";
import { GUARD_VERSION } from "@cellr/domain/intelligence";
import type { GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import { createSommelierService, type SommelierDeps } from "./service";
import { guardShadow, shadowCounts, type GuardShadow } from "./v1-guard";

/**
 * VARIANT E IN SHADOW MODE (S11). The guard judges the bottles V1 offered and must never change the answer: not its
 * words, not its bottles, not their order, not when it fails. What it would have done leaves the server as counts.
 */
let n = 0;
const item = (over: Partial<CellarItem>): CellarItem => {
  n += 1;
  return {
    vintageId: `${(0x200000 + n).toString(16)}bb-0000-4000-8000-000000000000`,
    wineId: `w${n}`,
    producer: `Producer ${n}`,
    wineName: `Wine ${n}`,
    type: "red",
    year: 2016,
    region: null,
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
      from: 2020,
      until: 2035,
      urgency: 5,
      yearsUntilOpen: null,
      yearsLeft: 9,
      position: 0.5,
    },
    ...over,
  };
};
const BAROLO = item({
  producer: "Giacomo Conterno",
  wineName: "Barolo",
  region: "Piemonte",
  appellation: "Barolo",
  countryCode: "IT",
});
const MUSCADET = item({
  producer: "Domaine de l'Écu",
  wineName: "Muscadet Sèvre et Maine",
  type: "white",
  region: "Loire",
  appellation: "Muscadet Sèvre et Maine",
  countryCode: "FR",
});
const RED_UNKNOWN = item({ producer: "Somebody", wineName: "Rouge" });

describe("the guard on its own", () => {
  it("flags a tannic red offered with oysters, and not the Muscadet", () => {
    const g = guardShadow(["What goes with oysters?"], [BAROLO, MUSCADET]);
    expect(g).toMatchObject({ version: GUARD_VERSION, considered: true, bottles: 2, flagged: 1 });
    expect(g.first).toBe(true);
    expect(g.flaggedIds).toEqual([BAROLO.vintageId]);
  });

  it("says nothing without a dish it can read, or about a wine known by its colour alone", () => {
    expect(guardShadow(["What should I open tonight?"], [BAROLO])).toMatchObject({
      considered: false,
      flagged: 0,
    });
    expect(guardShadow(["What goes with oysters?"], [RED_UNKNOWN])).toMatchObject({
      considered: true,
      flagged: 0,
    });
  });

  it("reads the latest of the person's turns that names a dish", () => {
    // "and cheaper?" names none: the oysters of the turn before are the dish.
    expect(guardShadow(["What goes with oysters?", "and cheaper?"], [BAROLO]).flagged).toBe(1);
    // A later dish replaces the earlier one: Barolo with braised beef is no clash.
    expect(guardShadow(["Oysters?", "No, with braised beef"], [BAROLO]).flagged).toBe(0);
  });

  it("lets only counts leave: no wine, no dish, no clash", () => {
    const counts = shadowCounts(guardShadow(["What goes with oysters?"], [BAROLO, MUSCADET]));
    expect(Object.keys(counts).sort()).toEqual([
      "bottles",
      "considered",
      "first",
      "flagged",
      "version",
    ]);
    const sent = JSON.stringify(counts);
    for (const secret of [BAROLO.vintageId, "oyster", "tannin", "Barolo"])
      expect(sent).not.toContain(secret);
  });
});

/** V1 with a model that offers every wine it is shown, in the order shown; or without a model at all. */
function v1(options: { items: CellarItem[]; ai: boolean; guard?: SommelierDeps["guard"] }) {
  const llm: LlmProvider = {
    async generateObject<T>(request: GenerateObjectRequest<T>) {
      const refs = [...request.user.matchAll(/^(\S+) \| /gm)].map((m) => m[1]!);
      return {
        ok: true as const,
        value: request.parse({ answer: "Open these.", bottle_refs: refs }),
        usage: { model: "chat-model", tokensIn: 10, tokensOut: 10, latencyMs: 1 },
      };
    },
  };
  const tonight = async (): Promise<TonightView> => ({
    dish: null,
    occasion: "weeknight",
    considered: options.items.length,
    personal: false,
    picks: options.items.map((i, idx) => ({
      slot: TONIGHT_SLOTS[idx % TONIGHT_SLOTS.length]!,
      match: "good" as const,
      reasons: [],
      vintageId: i.vintageId,
      bottleId: `b${idx}`,
      producer: i.producer,
      wineName: i.wineName,
      type: i.type,
      year: i.year,
      region: i.region,
      countryCode: i.countryCode,
      count: i.count,
      place: null,
      drinkPhase: i.drink.phase,
    })),
  });
  return createSommelierService({
    cellar: async () =>
      ({ items: options.items, bottleCount: 4, wineCount: options.items.length }) as never,
    storage: async () => [],
    racks: async () => ({ units: [], unplaced: [] }),
    tonight,
    llm: options.ai ? llm : null,
    spend: async () => {},
    householdId: async () => "h1",
    locale: async () => "en",
    recordUsage: async () => {},
    ...(options.guard !== undefined ? { guard: options.guard } : {}),
  });
}
const question = (text: string) => ({ messages: [{ role: "user" as const, text }] });

describe("V1 with the guard in shadow mode", () => {
  for (const ai of [true, false]) {
    it(`changes nothing about the answer (${ai ? "with" : "without"} a model)`, async () => {
      const items = [BAROLO, MUSCADET];
      const heard: GuardShadow[] = [];
      const plain = await v1({ items, ai }).ask(question("What goes with oysters?"));
      const shadowed = await v1({ items, ai, guard: guardShadow }).ask(
        question("What goes with oysters?"),
        { guard: (g) => heard.push(g) },
      );
      expect(shadowed).toEqual(plain);
      expect(plain.bottles.map((b) => b.vintageId)).toContain(BAROLO.vintageId);
      expect(heard).toHaveLength(1);
      expect(heard[0]).toMatchObject({ considered: true, flagged: 1 });
    });
  }

  it("a guard that fails is the shadow's problem, never the person's", async () => {
    const items = [BAROLO, MUSCADET];
    const heard: GuardShadow[] = [];
    const answer = await v1({
      items,
      ai: true,
      guard: () => {
        throw new Error("guard broke");
      },
    }).ask(question("What goes with oysters?"), { guard: (g) => heard.push(g) });
    expect(answer).toEqual(await v1({ items, ai: true }).ask(question("What goes with oysters?")));
    expect(heard).toEqual([]);
  });

  it("is not run without its switch, without a listener, or for a question of fact", async () => {
    const items = [BAROLO, MUSCADET];
    let calls = 0;
    const counting: SommelierDeps["guard"] = (texts, offered) => {
      calls += 1;
      return guardShadow(texts, offered);
    };
    await v1({ items, ai: true, guard: null }).ask(question("What goes with oysters?"), {
      guard: () => {},
    });
    await v1({ items, ai: true, guard: counting }).ask(question("What goes with oysters?"));
    await v1({ items, ai: true, guard: counting }).ask(question("How many bottles do I have?"), {
      guard: () => {},
    });
    expect(calls).toBe(0);
  });

  it("its counts pass the analytics rules", () => {
    const counts = shadowCounts(guardShadow(["What goes with oysters?"], [BAROLO]));
    expect(
      AnalyticsPropsSchema.safeParse({
        guard_v: counts.version,
        guard_judged: counts.considered,
        guard_bottles: counts.bottles,
        guard_flagged: counts.flagged,
        guard_first: counts.first,
      }).success,
    ).toBe(true);
  });
});
