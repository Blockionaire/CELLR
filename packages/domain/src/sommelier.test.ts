import { describe, expect, it } from "vitest";
import type { CellarItem } from "./cellar";
import {
  AskSommelierSchema,
  cellarDigest,
  checkSommelierAnswer,
  detectIntent,
  shortlistForQuestion,
  worthOpening,
} from "./sommelier";

let n = 0;
const item = (over: Partial<CellarItem> = {}): CellarItem => {
  n += 1;
  return {
    vintageId: `${(0xabc000 + n).toString(16)}00-0000-4000-8000-000000000000`,
    wineId: `w${n}`,
    producer: `Producer ${n}`,
    wineName: `Wine ${n}`,
    type: "red",
    year: 2015,
    region: "Bordeaux",
    countryCode: "FR",
    count: 2,
    places: ["Fridge"],
    unplaced: 0,
    image: null,
    favorite: false,
    rating: null,
    drink: {
      source: "estimate",
      phase: "peak",
      from: 2014,
      until: 2030,
      urgency: 5,
      yearsUntilOpen: null,
      yearsLeft: 4,
      position: 0.5,
    },
    ...over,
  };
};

describe("the request", () => {
  it("is a short conversation that ends with a question", () => {
    expect(
      AskSommelierSchema.safeParse({ messages: [{ role: "user", text: "What should I open?" }] })
        .success,
    ).toBe(true);
    expect(AskSommelierSchema.safeParse({ messages: [] }).success).toBe(false);
    expect(
      AskSommelierSchema.safeParse({ messages: [{ role: "assistant", text: "Hello" }] }).success,
    ).toBe(false);
    expect(
      AskSommelierSchema.safeParse({ messages: [{ role: "user", text: "x".repeat(801) }] }).success,
    ).toBe(false);
    expect(
      AskSommelierSchema.safeParse({ messages: [{ role: "user", text: "   " }] }).success,
    ).toBe(false);
    const long = Array.from({ length: 13 }, () => ({ role: "user" as const, text: "hi" }));
    expect(AskSommelierSchema.safeParse({ messages: long }).success).toBe(false);
  });
});

describe("what the model is shown", () => {
  it("is every wine, one line each, with a short name for pointing at it", () => {
    const items = [
      item({
        producer: "Château Margaux",
        wineName: "Pavillon Rouge",
        rating: { average: 9, count: 2 },
        favorite: true,
      }),
      item({ year: null, type: "sparkling", region: null, countryCode: null }),
    ];
    const digest = cellarDigest(items, "anything");
    const lines = digest.text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(
      "Château Margaux — Pavillon Rouge | 2015 | red | Bordeaux, FR | ×2 | drink: peak",
    );
    expect(lines[0]).toContain("rated 4.5★ (2)");
    expect(lines[0]).toContain("favourite");
    expect(lines[1]).toContain("| NV | sparkling | place unknown |");
    expect(digest.total).toBe(2);
    // Every line starts with its own short name, which leads back to exactly that wine.
    for (const [ref, found] of digest.refs)
      expect(digest.text).toContain(`${ref} | ${found.producer}`);
  });

  it("gives wines names that cannot be confused, even when their ids start alike", () => {
    const same = ["aaaaaa11", "aaaaaa22", "aaaaaa33"].map((p) =>
      item({ vintageId: `${p}-0000-4000-8000-000000000000` }),
    );
    const digest = cellarDigest(same, "x");
    expect(new Set(digest.refs.keys()).size).toBe(3);
    expect(new Set([...digest.refs.values()].map((i) => i.vintageId)).size).toBe(3);
  });

  it("with a big cellar, shows the wines the question is about first, not just the newest", () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      item({ producer: `Estate ${i}`, region: i === 250 ? "Barolo" : "Bordeaux" }),
    );
    const shown = shortlistForQuestion(many, "Which Barolo should I open?", 120);
    expect(shown).toHaveLength(120);
    expect(shown[0]!.region).toBe("Barolo");
    const small = shortlistForQuestion(many.slice(0, 50), "anything", 120);
    expect(small).toHaveLength(50);
    expect(cellarDigest(many, "Barolo").total).toBe(300);
  });
});

describe("what the model says is checked", () => {
  const items = [
    item({ producer: "Château Margaux" }),
    item({ producer: "Bollinger" }),
    item({}),
    item({}),
  ];
  const digest = cellarDigest(items, "x");
  const refOf = (i: number) => [...digest.refs.keys()][i]!;

  it("keeps the words and the wines that exist, in order", () => {
    const result = checkSommelierAnswer(
      { answer: "  Open the Margaux.\n\n\n\nIt is ready. ", bottle_refs: [refOf(1), refOf(0)] },
      digest,
    )!;
    expect(result.text).toBe("Open the Margaux.\n\nIt is ready.");
    expect(result.bottles.map((b) => b.producer)).toEqual(["Bollinger", "Château Margaux"]);
  });

  it("gives a wine it made up no card, and counts no wine twice", () => {
    const result = checkSommelierAnswer(
      {
        answer: "Try this.",
        bottle_refs: ["deadbeef", refOf(0), refOf(0), " " + refOf(0) + " ", "../../etc"],
      },
      digest,
    )!;
    expect(result.bottles).toHaveLength(1);
  });

  it("never points at more than three", () => {
    const result = checkSommelierAnswer(
      { answer: "All of them.", bottle_refs: [0, 1, 2, 3].map(refOf) },
      digest,
    )!;
    expect(result.bottles).toHaveLength(3);
  });

  it("makes the words safe to show: no control characters, not endless", () => {
    const result = checkSommelierAnswer(
      { answer: "Hello\u0000\u0007 there" + "!".repeat(2000), bottle_refs: [] },
      digest,
    )!;
    expect([...result.text].some((c) => c.charCodeAt(0) < 9)).toBe(false);
    expect(result.text.length).toBeLessThanOrEqual(900);
  });

  it("says nothing rather than something empty", () => {
    expect(
      checkSommelierAnswer({ answer: "  \u0000 ", bottle_refs: [refOf(0)] }, digest),
    ).toBeNull();
  });
});

describe("understanding a question without AI", () => {
  it.each([
    ["What goes with steak tonight?", "steak", "anything"],
    ["Wat past bij een biefstuk?", "steak", "anything"],
    ["We have oysters for the new year", "shellfish", "celebration"],
    ["Spaghetti with friends over", "pasta-tomato", "guests"],
    ["Something with mushroom risotto", "mushrooms", "anything"],
    ["a wine for salmon", "oily-fish", "anything"],
    ["cod and chips", "white-fish", "anything"],
    ["Chicken curry", "curry", "anything"],
    ["blue cheese after dinner", "blue-cheese", "anything"],
    ["Hamburgers on the bbq", "burger", "anything"],
    ["What should I drink before it is too late?", null, "use-it-up"],
    ["Which bottles are at their peak?", null, "use-it-up"],
    ["Hello", null, "anything"],
  ])("%s", (question, dish, occasion) => {
    expect(detectIntent(question)).toEqual({ dish, occasion });
  });
});

describe("what is worth opening when nothing is asked", () => {
  it("is what is ready or past its best, most urgent first", () => {
    const urgent = item({
      drink: {
        source: "estimate",
        phase: "past",
        from: 2010,
        until: 2020,
        urgency: 1,
        yearsUntilOpen: null,
        yearsLeft: -2,
        position: 1.2,
      },
    });
    const ready = item({
      drink: {
        source: "estimate",
        phase: "ready",
        from: 2020,
        until: 2030,
        urgency: 3,
        yearsUntilOpen: null,
        yearsLeft: 4,
        position: 0.1,
      },
    });
    const later = item({
      drink: {
        source: "estimate",
        phase: "young",
        from: 2035,
        until: 2050,
        urgency: 9,
        yearsUntilOpen: 9,
        yearsLeft: null,
        position: -1,
      },
    });
    const result = worthOpening([later, ready, urgent]);
    expect(result.kind).toBe("soon");
    expect(result.items).toEqual([urgent, ready]);
  });
  it("otherwise your favourites and best rated", () => {
    const later = (over: Partial<CellarItem>) =>
      item({
        drink: {
          source: "estimate",
          phase: "peak",
          from: 2020,
          until: 2040,
          urgency: 6,
          yearsUntilOpen: null,
          yearsLeft: 10,
          position: 0.4,
        },
        ...over,
      });
    const fav = later({ favorite: true });
    const loved = later({ rating: { average: 9, count: 1 } });
    const plain = later({});
    const result = worthOpening([plain, loved, fav]);
    expect(result.kind).toBe("favorites");
    expect(result.items).toEqual([fav, loved]);
  });
  it("otherwise just the first few, and says so", () => {
    const plain = item({});
    expect(worthOpening([plain])).toEqual({ kind: "nothing", items: [plain] });
    expect(worthOpening([])).toEqual({ kind: "nothing", items: [] });
  });
});
