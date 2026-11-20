import { describe, expect, it } from "vitest";
import { groupTasteScore, NO_TASTE, tasteScore, type TasteSignals } from "./pairing-engine/taste";
import type { WineStructure } from "./pairing-engine/wine";
import {
  asksOwnCellar,
  findMentions,
  hasAnyMention,
  MAX_MENTIONS,
  withoutAnyMention,
  withoutMentions,
} from "./social";

describe("mentions", () => {
  it("finds account names", () => {
    expect(findMentions("@anna is coming for dinner, and @pieter_2 too")).toEqual([
      "anna",
      "pieter_2",
    ]);
    expect(findMentions("Wat schenk ik voor @Anna.Jansen?")).toEqual(["anna.jansen"]);
    expect(findMentions("Dinner with @anna.")).toEqual(["anna"]);
    expect(findMentions("(@anna)")).toEqual(["anna"]);
  });
  it("names each person once and never more than the limit", () => {
    expect(findMentions("@anna @ANNA @anna")).toEqual(["anna"]);
    const many = Array.from({ length: 12 }, (_, i) => `@friend${i}`).join(" ");
    expect(findMentions(many)).toHaveLength(MAX_MENTIONS);
  });
  it("is not fooled by e-mail addresses, short names or odd characters", () => {
    expect(findMentions("mail me at joe@example.com")).toEqual([]);
    expect(findMentions("@ab is too short, @@anna is odd")).toEqual([]);
    expect(findMentions("@anna'; drop table friends;--")).toEqual(["anna"]);
    // Longer than a name can be: not the first twenty characters of it, which could be someone else.
    expect(findMentions("@" + "a".repeat(40))).toEqual([]);
    expect(findMentions("@00000000-0000-4000-8000-000000000001")).toEqual(["00000000"]);
  });
  it("takes mentions out of the text the food engine reads", () => {
    expect(withoutMentions("Pasta for @pasta.lover and @steak_fan tonight")).toBe(
      "Pasta for and tonight",
    );
    expect(withoutMentions("no mention here")).toBe("no mention here");
  });
});

const wine = (type: "red" | "white", s: Partial<WineStructure>, keys: string[] = []) => ({
  type,
  keys: [type, ...keys],
  structure: {
    body: 3,
    tannin: 3,
    acidity: 3.5,
    sweetness: 0.5,
    intensity: 3,
    oak: 1,
    alcohol: 2,
    fizz: false,
    ...s,
  },
});
const pauillac = wine("red", { body: 4.5, tannin: 4.5 }, ["bordeaux", "cabernet sauvignon"]);
const muscadet = wine("white", { body: 1, tannin: 0, acidity: 5 }, ["muscadet", "loire"]);

describe("taste as a score", () => {
  it("is zero when nothing is known", () => {
    expect(tasteScore(pauillac, null)).toBe(0);
    expect(tasteScore(pauillac, NO_TASTE)).toBe(0);
  });
  it("rises for what the ratings favour and what was said", () => {
    const bordeauxLover: TasteSignals = {
      ...NO_TASTE,
      styles: ["red"],
      likes: ["Bordeaux"],
      focus: "red",
    };
    expect(tasteScore(pauillac, bordeauxLover)).toBeGreaterThan(0.7);
    expect(tasteScore(muscadet, bordeauxLover)).toBeLessThan(0);
  });
  it("follows the stated scales, more than the trends", () => {
    const light: TasteSignals = { ...NO_TASTE, said: { body: 1, tannin: 1 } };
    expect(tasteScore(muscadet, light)).toBeGreaterThan(0.2);
    expect(tasteScore(pauillac, light)).toBeLessThan(-0.2);
    const mixed: TasteSignals = { ...NO_TASTE, said: { body: 1 }, trends: { body: 5 } };
    expect(tasteScore(muscadet, mixed)).toBeGreaterThan(tasteScore(pauillac, mixed));
  });
  it("stays between -1 and 1", () => {
    const all: TasteSignals = {
      focus: "red",
      styles: ["red"],
      likes: ["bordeaux"],
      said: { body: 5, tannin: 5 },
      trends: { body: 5 },
    };
    expect(tasteScore(pauillac, all)).toBeLessThanOrEqual(1);
    expect(tasteScore(muscadet, all)).toBeGreaterThanOrEqual(-1);
  });
});

describe("a table of several people", () => {
  it("is pulled toward whoever likes the wine least", () => {
    expect(groupTasteScore([])).toBe(0);
    expect(groupTasteScore([0.6])).toBe(0.6);
    expect(groupTasteScore([1, 1, -1])).toBeLessThan(0);
    expect(groupTasteScore([0.4, 0.4, 0.4])).toBe(0.4);
    // A wine everyone finds fine beats one two love and one dislikes.
    expect(groupTasteScore([0.3, 0.3, 0.3])).toBeGreaterThan(groupTasteScore([1, 1, -0.8]));
  });
});

describe("names that are almost names", () => {
  it("does not look up the first part of something longer", () => {
    expect(findMentions("@abcdefghijklmnopqrs.t")).toEqual([]);
    expect(findMentions("@anna.jansen and @bram")).toEqual(["anna.jansen", "bram"]);
  });
  it("reads a full-width @ and ignores invisible characters", () => {
    expect(findMentions("dinner with ＠anna")).toEqual(["anna"]);
    expect(findMentions("dinner with @an​na")).toEqual(["anna"]);
  });
  it("takes everything that looks like a name out of text bound for a model", () => {
    const text = "x.@anna, @@bram; ＠carla and @аnna (and joe@example.com) for dinner";
    expect(hasAnyMention(text)).toBe(true);
    expect(withoutAnyMention(text)).not.toMatch(/@|＠|anna|bram|carla|example/);
    expect(withoutAnyMention(text)).toContain("for dinner");
    expect(hasAnyMention("no names here")).toBe(false);
    expect(withoutAnyMention("no names here")).toBe("no names here");
    // Not mentions, and still possibly names: a space after the "@", or the "@" behind the word.
    expect(withoutAnyMention("Dinner with @ Anna tomorrow")).toBe("Dinner tomorrow");
    expect(withoutAnyMention("Anna@ is coming for lamb")).toBe("is coming for lamb");
    expect(withoutAnyMention("write to jan.de.vries@example.com about the Barolo")).toBe(
      "write about the Barolo",
    );
    expect(withoutAnyMention("lamb for ＠Bram")).toBe("lamb");
  });
});

describe("a follow-up that turns to the asker's own wines", () => {
  it.each([
    "And what do I have myself for the lamb?",
    "What about my own cellar?",
    "Can I open something of mine?",
    "En wat heb ik zelf liggen?",
    "En uit mijn eigen kelder?",
  ])("%s", (question) => expect(asksOwnCellar(question)).toBe(true));
  it.each(["And with oysters?", "Up to 50 euros", "En bij de vis?", "Something lighter?"])(
    "not: %s",
    (question) => expect(asksOwnCellar(question)).toBe(false),
  );
});
