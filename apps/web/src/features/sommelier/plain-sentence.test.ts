import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import {
  cellarFacts,
  type CellarItem,
  type RackView,
  type SommelierAnswer,
  type StorageUnitView,
} from "@cellr/domain";
import en from "../../../messages/en.json";
import nl from "../../../messages/nl.json";
import { plainSentence } from "./plain-sentence";

// The plain (no-AI) answers to questions about the cellar, in both languages: each answers what was asked.
const t = {
  en: createTranslator({ locale: "en", messages: en, namespace: "sommelier" }),
  nl: createTranslator({ locale: "nl", messages: nl, namespace: "sommelier" }),
};
const say = (facts: NonNullable<SommelierAnswer["facts"]>, lang: "en" | "nl") =>
  plainSentence(
    { source: "basic", text: null, basic: "facts", facts, bottles: [], reason: "ai-off" },
    t[lang] as never,
  );
const base = { bottles: 9, wines: 4, free: 20, located: [], names: [], matchedBottles: 0 };
const musar18 = {
  vintageId: "v18",
  wine: "Château Musar Rouge",
  year: 2018,
  count: 3,
  spots: [
    { place: "Wine fridge", row: 2, col: 3 },
    { place: "Wine rack", row: 1, col: 6 },
  ],
  unplaced: 1,
};

describe("plain answers say what was asked", () => {
  it("quantity: the bottles of every matching vintage, summed, and no spots", () => {
    const facts = { ...base, matches: 2, kind: "quantity" as const, matchedBottles: 5 };
    expect(say(facts, "en")).toBe("You have 5 bottles of that, across 2 vintages.");
    expect(say(facts, "nl")).toBe("Je hebt daarvan 5 flessen, verdeeld over 2 jaargangen.");
    expect(say({ ...facts, matches: 1, matchedBottles: 1 }, "nl")).toBe("Je hebt daarvan 1 fles.");
    expect(say(facts, "en")).not.toMatch(/shelf|fridge/i);
  });

  it("location: every spot of the one wine, and the bottle without a place", () => {
    const facts = { ...base, matches: 1, kind: "location" as const, located: [musar18] };
    expect(say(facts, "en")).toBe(
      "Château Musar Rouge 2018 (3 bottles): Wine fridge, shelf 2, position 3; Wine rack, shelf 1, position 6; 1 bottle without a place yet.",
    );
    expect(say(facts, "nl")).toBe(
      "Château Musar Rouge 2018 (3 flessen): Wine fridge, plank 2, positie 3; Wine rack, plank 1, positie 6; 1 fles nog zonder plek.",
    );
  });

  it("location with several fitting wines: asks which one, picks none", () => {
    const facts = { ...base, matches: 2, kind: "location" as const };
    expect(say(facts, "en")).toBe("2 wines fit that: which one do you mean?");
    expect(say(facts, "nl")).toBe("2 wijnen passen daarbij: welke bedoel je?");
  });

  it("selection: the matching wines by name", () => {
    const facts = {
      ...base,
      matches: 2,
      kind: "selection" as const,
      names: ["Château Carbonnieux Blanc 2019", "Domaine Leflaive Mâcon 2020"],
    };
    expect(say(facts, "en")).toBe(
      "These 2 wines fit: Château Carbonnieux Blanc 2019, Domaine Leflaive Mâcon 2020.",
    );
    expect(say(facts, "nl")).toBe(
      "Deze 2 wijnen passen: Château Carbonnieux Blanc 2019, Domaine Leflaive Mâcon 2020.",
    );
    expect(say({ ...facts, matches: 14 }, "en")).toMatch(/, and 12 more\.$/);
  });

  it("no wine named: the cellar-wide totals; named but missing: not found", () => {
    expect(say({ ...base, matches: null, kind: "quantity" }, "en")).toBe(
      "Your cellar holds 9 bottles of 4 different wines, with 20 free spots.",
    );
    expect(say({ ...base, matches: 0, kind: "selection" }, "nl")).toMatch(
      /^Die wijn ligt niet in je kelder\./,
    );
  });
});

describe("the question decides what the facts are for", () => {
  const item = (id: string, year: number, count: number, type = "red"): CellarItem =>
    ({
      vintageId: id,
      wineId: id.startsWith("m") ? "musar" : id,
      producer: id.startsWith("m") ? "Château Musar" : "Château Carbonnieux",
      wineName: id.startsWith("m") ? "Rouge" : "Blanc",
      type,
      year,
      region: null,
      countryCode: "LB",
      count,
    }) as CellarItem;
  const items = [item("m18", 2018, 3), item("m16", 2016, 2), item("c19", 2019, 1, "white")];
  const storage: StorageUnitView[] = [];
  const racks: RackView = { units: [], unplaced: [] };
  it.each([
    ["Hoeveel flessen Musar heb ik?", "quantity", 2],
    ["How many bottles of Musar do I have?", "quantity", 2],
    ["Waar ligt mijn Musar 2018?", "location", 1],
    ["Where is my Musar 2018?", "location", 1],
    ["Welke witte wijnen heb ik?", "selection", 1],
    ["Which white wines do I have?", "selection", 1],
    ["Heb ik nog een Musar?", "selection", 2],
  ] as const)("%s → %s", (question, kind, matches) => {
    const f = cellarFacts(items, storage, racks, question);
    expect(f.kind).toBe(kind);
    expect(f.matches).toHaveLength(matches);
  });
});
