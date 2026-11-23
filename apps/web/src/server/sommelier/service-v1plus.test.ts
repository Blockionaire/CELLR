import { describe, expect, it } from "vitest";
import {
  parseSommelierParts,
  SOMMELIER_PARTS,
  type AskSommelier,
  type CellarItem,
  type SommelierAnswer,
  type SommelierPart,
} from "@cellr/domain";
import type { GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import { SOMMELIER_SYSTEM } from "@/server/ai/prompts/sommelier";
import { SOMMELIER_SYSTEM_V7 } from "@/server/ai/prompts/sommelier-v7";
import { createSommelierIntelligence } from "./intelligence";
import { createSommelierFallback } from "./parts/fallback";
import { createSommelierService } from "./service";

/**
 * SOMMELIER V1+, ALL PARTS TOGETHER (P3–P7). Each part has its own tests (service.test.ts, parts/, the domain).
 * These prove what only shows when they are combined: every subset of the five parts answers every kind of
 * question without an error and with at most one model call, each part's field appears only when that part is on,
 * and one conversation can go from advice to serving, a menu, the bottles for the guests and a model that is down
 * with the parts agreeing with each other.
 */

const NOW = new Date("2026-11-23T12:00:00Z");

const wine = (n: number, over: Partial<CellarItem>): CellarItem => ({
  vintageId: `${(0x200000 + n).toString(16)}bb-0000-4000-8000-000000000000`,
  wineId: `w${n}`,
  producer: `Producer ${n}`,
  wineName: `Wine ${n}`,
  type: "red",
  year: 2018,
  region: "Tuscany",
  countryCode: "IT",
  count: 2,
  places: ["Fridge"],
  unplaced: 0,
  image: null,
  favorite: false,
  rating: null,
  drink: {
    source: "ai",
    reliable: true,
    uncertain: false,
    phase: "peak",
    from: 2024,
    until: 2032,
    urgency: 5,
    yearsUntilOpen: null,
    yearsLeft: 6,
    position: 0.4,
  },
  ...over,
});

const cellar = (): CellarItem[] => [
  wine(1, {
    producer: "Bollinger",
    wineName: "Special Cuvée",
    type: "sparkling",
    year: null,
    region: "Champagne",
    countryCode: "FR",
  }),
  wine(2, {
    producer: "Antinori",
    wineName: "Tignanello",
    count: 6,
    reserved: { count: 4, title: "Anniversary", on: null } as never,
  }),
  wine(3, {
    producer: "Château Margaux",
    wineName: "Pavillon Rouge",
    year: 2015,
    region: "Bordeaux",
    countryCode: "FR",
    count: 3,
    places: ["Fridge", "Rack"],
  }),
  wine(4, {
    producer: "Taylor's",
    wineName: "Vintage Port",
    type: "fortified",
    year: 2000,
    region: "Douro",
    countryCode: "PT",
    count: 1,
  }),
];
const ref = (i: CellarItem) => i.vintageId.replace(/-/g, "").slice(0, 6);

type Model = (request: GenerateObjectRequest<unknown>, items: CellarItem[]) => unknown;

function world(parts: string, model: Model | "down" | "none") {
  const items = cellar();
  const requests: GenerateObjectRequest<unknown>[] = [];
  const llm: LlmProvider = {
    async generateObject<T>(request: GenerateObjectRequest<T>) {
      requests.push(request as GenerateObjectRequest<unknown>);
      const usage = { model: "chat-model", tokensIn: 600, tokensOut: 80, latencyMs: 900 };
      if (model === "down" || model === "none")
        return { ok: false as const, kind: "unavailable" as const, usage };
      return {
        ok: true as const,
        value: request.parse(model(request as GenerateObjectRequest<unknown>, items)),
        usage,
      };
    },
  };
  const service = createSommelierService({
    cellar: async () => ({ items, bottleCount: items.reduce((s, i) => s + i.count, 0) }),
    storage: async () => [],
    racks: async () => ({ units: [], unplaced: [] }),
    tonight: async (request) => ({
      dish: request.dish,
      occasion: request.occasion,
      picks: items.slice(1, 3).map((i, idx) => ({
        slot: (["best", "alternative"] as const)[idx]!,
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
      considered: items.length,
    }),
    llm: model === "none" ? null : llm,
    parts: parseSommelierParts(parts),
    fallback: createSommelierFallback({
      intelligence: createSommelierIntelligence({
        cellar: async () => ({ items, bottleCount: items.length }),
        profiles: async () => new Map(),
        taste: async () => null,
        offers: null,
        buying: false,
        now: () => NOW,
      }),
      spend: async () => {},
    }),
    profiles: async () => new Map(),
    now: () => NOW,
    spend: async () => {},
    householdId: async () => "h1",
    locale: async () => "en",
    recordUsage: async () => {},
  });
  return { service, items, requests };
}

/** A model that answers every question sensibly, in the shape the request asks for. */
const sensible: Model = (request, items) => {
  const wantsCourses = (request.jsonSchema as { required?: string[] }).required?.includes(
    "courses",
  );
  const v7 = request.system === SOMMELIER_SYSTEM_V7;
  const name = (i: CellarItem) => (v7 ? `[[${ref(i)}]]` : `the ${i.wineName}`);
  return {
    answer: `Open ${name(items[2]!)}; ${name(items[1]!)} would be firmer.`,
    bottle_refs: [ref(items[2]!), ref(items[1]!)],
    verdict: "match",
    buy: [],
    used_taste: false,
    ...(wantsCourses
      ? {
          courses: [
            { course: 1, ref: ref(items[0]!), why: "Bubbles and brine." },
            { course: 2, ref: ref(items[2]!), why: "Cabernet for the lamb." },
            { course: 3, ref: ref(items[3]!), why: "Port loves chocolate." },
          ],
        }
      : {}),
  };
};

const QUESTIONS: Array<{ name: string; request: AskSommelier }> = [
  {
    name: "a pairing",
    request: { messages: [{ role: "user", text: "What goes with roast lamb?" }] },
  },
  {
    name: "a pairing for eight people",
    request: {
      messages: [{ role: "user", text: "We are 8 for dinner. What goes with roast lamb?" }],
    },
  },
  {
    name: "a serving question",
    request: { messages: [{ role: "user", text: "How should I serve the Tignanello?" }] },
  },
  {
    name: "a menu for six",
    request: {
      messages: [
        {
          role: "user",
          text: "Dinner for 6 people: oysters to start, then roast lamb, and for dessert a chocolate fondant. Which wine with each course?",
        },
      ],
    },
  },
  {
    name: "a comparison",
    request: {
      messages: [{ role: "user", text: "The Tignanello or the Pavillon Rouge with the lamb?" }],
    },
  },
  {
    name: "a question of fact",
    request: { messages: [{ role: "user", text: "How many bottles of Tignanello do I have?" }] },
  },
  {
    name: "tonight, with a budget",
    request: {
      messages: [{ role: "user", text: "Steak for 4 people tonight" }],
      mode: "tonight",
      budget: "mid",
    },
  },
];

const SUBSETS: SommelierPart[][] = Array.from({ length: 2 ** SOMMELIER_PARTS.length }, (_, mask) =>
  SOMMELIER_PARTS.filter((_, bit) => (mask & (1 << bit)) !== 0),
);

describe("every combination of the five parts", () => {
  it("is 32 combinations", () => expect(SUBSETS).toHaveLength(32));

  for (const model of ["answers", "down", "none"] as const)
    it(`answers every kind of question with at most one model call, and each part adds only its own field (model: ${model})`, async () => {
      for (const subset of SUBSETS) {
        const on = (part: SommelierPart) => subset.includes(part);
        for (const q of QUESTIONS) {
          const label = `[${subset.join(",") || "none"}] ${q.name}`;
          const { service, requests } = world(
            subset.join(","),
            model === "answers" ? sensible : model,
          );
          const answer = await service.ask(q.request);
          expect(requests.length, label).toBeLessThanOrEqual(model === "none" ? 0 : 1);
          // The prompt version follows `check`, and nothing else.
          for (const r of requests)
            expect(r.system, label).toBe(on("check") ? SOMMELIER_SYSTEM_V7 : SOMMELIER_SYSTEM);
          if (!on("check")) expect(answer, label).not.toHaveProperty("check");
          if (!on("annotate")) expect(answer, label).not.toHaveProperty("annotations");
          if (!on("quantities")) expect(answer, label).not.toHaveProperty("quantity");
          if (!on("menu")) expect(answer, label).not.toHaveProperty("menu");
          if (!on("fallback") || model === "answers") expect(answer.plan ?? null, label).toBeNull();
          // What is added always belongs to the cards that are shown.
          const cards = new Set(answer.bottles.map((b) => b.vintageId));
          for (const a of answer.annotations ?? [])
            expect(cards.has(a.vintageId), label).toBe(true);
          for (const w of answer.quantity?.wines ?? [])
            expect(cards.has(w.vintageId), label).toBe(true);
          for (const c of answer.menu?.courses ?? [])
            if (c.vintageId !== null) expect(cards.has(c.vintageId), label).toBe(true);
          // Never a ref left unrendered, never a price, whatever the combination.
          const shown = JSON.stringify({ ...answer, plan: undefined });
          if (on("check")) expect(shown, label).not.toContain("[[");
          expect(shown, label).not.toContain("€");
          // A question of fact is left alone by every part but the check of its words.
          if (q.name === "a question of fact") {
            expect(answer, label).not.toHaveProperty("annotations");
            expect(answer, label).not.toHaveProperty("quantity");
            expect(answer, label).not.toHaveProperty("menu");
            expect(answer.plan ?? null, label).toBeNull();
          }
        }
      }
    });
});

describe("one conversation with every part on", () => {
  const ALL = SOMMELIER_PARTS.join(",");
  const said = (a: SommelierAnswer) => a.text ?? "(shown from the cards)";

  it("advice, serving, a menu for the guests, a follow-up and a model that is down agree with each other", async () => {
    const history: Array<{ role: "user" | "assistant"; text: string }> = [];
    const turn = async (text: string, model: Model | "down") => {
      const w = world(ALL, model);
      const answer = await w.service.ask({ messages: [...history, { role: "user", text }] });
      history.push({ role: "user", text }, { role: "assistant", text: said(answer).slice(0, 800) });
      return { answer, ...w };
    };

    // 1. Advice: V1's first wine first, its name the cellar's own, facts on both cards.
    const advice = await turn("What goes with roast lamb?", sensible);
    expect(advice.answer.text).toBe(
      "Open Château Margaux Pavillon Rouge 2015; Antinori Tignanello 2018 would be firmer.",
    );
    expect(advice.answer.bottles.map((b) => b.wineName)).toEqual(["Pavillon Rouge", "Tignanello"]);
    expect(advice.answer.check).toEqual({ v: 1, text: "kept", codes: [] });
    expect(advice.answer.annotations).toHaveLength(2);
    expect(advice.answer.annotations?.[1]?.reserved).toMatchObject({ count: 4, free: 2 });
    expect(advice.answer).not.toHaveProperty("quantity");
    expect(advice.requests).toHaveLength(1);

    // 2. Serving the wine just named: the app's facts go to the model, and its card shows them.
    const serving = await turn("How long should I decant it?", (request, items) => {
      expect(request.user).toContain("Serving facts (worked out by the app");
      expect(request.user).toContain("Château Margaux — Pavillon Rouge | 2015");
      return {
        answer: `Pour [[${ref(items[2]!)}]] gently; it needs little air.`,
        bottle_refs: [],
        verdict: "not_pairing",
        buy: [],
        used_taste: false,
      };
    });
    expect(serving.answer.bottles.map((b) => b.wineName)).toEqual(["Pavillon Rouge"]);
    expect(serving.answer.annotations?.[0]?.serving).not.toBeNull();
    expect(serving.requests).toHaveLength(1);

    // 3. A menu for six: one call, one checked wine per course, a reason that invents a bottle is left out, and
    //    the bottles are counted course by course with a small pour of the port.
    const menu = await turn(
      "We will be 6 at dinner: oysters to start, then roast lamb, and for dessert a chocolate fondant. Which wine with each course?",
      (request, items) => {
        expect(request.user).toContain(
          "Menu (the person's courses, in the order they are served):",
        );
        expect(request.user).toContain("- 6 people, a dinner.");
        expect((request.jsonSchema as { required: string[] }).required).toContain("courses");
        return {
          answer: "From bubbles to port.",
          bottle_refs: [],
          verdict: "match",
          buy: [],
          used_taste: false,
          courses: [
            { course: 1, ref: ref(items[0]!), why: `[[${ref(items[0]!)}]] cuts the brine.` },
            { course: 2, ref: ref(items[2]!), why: "Your Sassicaia 2016 would be better still." },
            { course: 3, ref: ref(items[3]!), why: "Port loves chocolate, and costs about €40." },
          ],
        };
      },
    );
    expect(menu.requests).toHaveLength(1);
    expect(menu.answer.menu?.courses.map((c) => [c.vintageId !== null, c.why])).toEqual([
      [true, "Bollinger Special Cuvée cuts the brine."],
      [true, null],
      [true, null],
    ]);
    expect(JSON.stringify(menu.answer)).not.toMatch(/Sassicaia|€/);
    expect(menu.answer.bottles).toHaveLength(3);
    expect(menu.answer.annotations).toHaveLength(3);
    expect(menu.answer.quantity).toMatchObject({ guests: 6, mode: "sequence" });
    expect(menu.answer.quantity?.wines.map((w) => w.vintageId)).toEqual(
      menu.answer.bottles.map((b) => b.vintageId),
    );
    // Three bottles are needed for six at dinner; each course is rounded up, the port poured small.
    expect(menu.answer.quantity?.needed).toBeGreaterThanOrEqual(3);
    const port = menu.answer.quantity!.wines[2]!;
    expect(port).toMatchObject({ needed: 1, available: 1, short: 0 });

    // 4. A follow-up: the menu and the guests are still known, the answer is V1's ordinary one.
    const follow = await turn("And if we add a cheese course before dessert?", (request, items) => {
      expect(request.user).toContain("Menu (context only:");
      expect(request.user).toContain("- 6 people, a dinner.");
      expect((request.jsonSchema as { required: string[] }).required).not.toContain("courses");
      return {
        answer: `Stay with [[${ref(items[2]!)}]] for the cheese.`,
        bottle_refs: [ref(items[2]!)],
        verdict: "match",
        buy: [],
        used_taste: false,
      };
    });
    expect(follow.answer.text).toBe(
      "Stay with Château Margaux Pavillon Rouge 2015 for the cheese.",
    );
    expect(follow.answer).not.toHaveProperty("menu");
    expect(follow.answer.quantity).toMatchObject({ guests: 6, mode: "alternatives" });

    // 5. The model goes down: the engines answer, with the reason, the same facts on their cards and the count.
    const down = await turn("What goes with a grilled steak?", "down");
    expect(down.requests).toHaveLength(1);
    expect(down.answer).toMatchObject({ source: "basic", reason: "ai-down" });
    expect(down.answer.plan?.picks.length).toBeGreaterThan(0);
    expect(down.answer.annotations?.map((a) => a.vintageId)).toEqual(
      down.answer.bottles.map((b) => b.vintageId),
    );
    expect(down.answer.quantity).toMatchObject({ guests: 6 });
    expect(down.answer).not.toHaveProperty("check");
    expect(JSON.stringify(down.answer)).not.toContain("€");
  });
});
