import { describe, expect, it } from "vitest";
import type { CellarItem, InsightOutput } from "@cellr/domain";
import { createSommelierIntelligence } from "./intelligence";

/**
 * WHAT IS REMEMBERED, AND FOR HOW LONG. The engines read a household's wines once per question and keep that
 * reading for the length of that question only. Nothing read for one question is there for the next, so nothing
 * read for one household can be there for another: there is no cache across questions to get wrong.
 */
let n = 0;
const wine = (wineName: string, type: CellarItem["type"], appellation: string): CellarItem => ({
  vintageId: `${(0x500000 + ++n).toString(16)}aa-0000-4000-8000-000000000000`,
  wineId: `w${n}`,
  producer: "Domaine Exemple",
  wineName,
  type,
  year: 2019,
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

describe("what the engines remember between questions", () => {
  it("reads the cellar, the profiles and the taste anew for every question, and once per question", async () => {
    const calls = { cellar: 0, profiles: [] as string[][], taste: 0 };
    const households = [
      [wine("Pauillac", "red", "Pauillac")],
      [wine("Saint-Julien", "red", "Saint-Julien")],
    ];
    const intelligence = createSommelierIntelligence({
      // The same engines, asked by two households in turn: each read returns whoever asks now.
      cellar: async () => {
        const items = households[calls.cellar++ % 2]!;
        return { items, bottleCount: items.length * 2 };
      },
      profiles: async (ids) => {
        calls.profiles.push([...ids]);
        return new Map<string, InsightOutput>();
      },
      taste: async () => {
        calls.taste += 1;
        return null;
      },
      offers: null,
      buying: true,
      experiences: true,
      now: () => new Date("2026-11-19T18:00:00Z"),
    });
    const ask = () =>
      intelligence.plan({
        question: "What should I open with roast lamb?",
        state: undefined,
        budgetEuros: null,
        personal: true,
        locale: "en",
      });

    const first = (await ask())!;
    const second = (await ask())!;
    const third = (await ask())!;
    // Each answer holds the wines of the household that asked, and none of the other's.
    expect(first.bottles.map((b) => b.vintageId)).toEqual([households[0]![0]!.vintageId]);
    expect(second.bottles.map((b) => b.vintageId)).toEqual([households[1]![0]!.vintageId]);
    expect(third.bottles.map((b) => b.vintageId)).toEqual([households[0]![0]!.vintageId]);
    // Read once per question, never reused from the question before.
    expect(calls.cellar).toBe(3);
    expect(calls.taste).toBe(3);
    expect(calls.profiles).toEqual([
      [households[0]![0]!.vintageId],
      [households[1]![0]!.vintageId],
      [households[0]![0]!.vintageId],
    ]);
  });

  it("carries nothing over through the conversation's state but what the person said", async () => {
    const a = wine("Pauillac", "red", "Pauillac");
    const b = wine("Saint-Julien", "red", "Saint-Julien");
    const of = (items: CellarItem[]) =>
      createSommelierIntelligence({
        cellar: async () => ({ items, bottleCount: items.length * 2 }),
        profiles: async () => new Map(),
        taste: async () => null,
        offers: null,
        buying: true,
        now: () => new Date("2026-11-19T18:00:00Z"),
      });
    const first = (await of([a]).plan({
      question: "What should I open with roast lamb?",
      state: undefined,
      budgetEuros: null,
      personal: true,
      locale: "en",
    }))!;
    // The state names the bottle that was offered. Sent along to another household's engines (a state a client
    // made up, or one from a household the person has left), it cannot bring that bottle into the answer.
    expect(first.plan.state.offered).toEqual([a.vintageId]);
    const elsewhere = (await of([b]).plan({
      question: "And another one?",
      state: first.plan.state,
      budgetEuros: null,
      personal: true,
      locale: "en",
    }))!;
    const shown = [...elsewhere.bottles, ...elsewhere.otherBottles].map((x) => x.vintageId);
    expect(shown).not.toContain(a.vintageId);
    expect(JSON.stringify(elsewhere.plan.picks)).not.toContain(a.vintageId);
  });
});
