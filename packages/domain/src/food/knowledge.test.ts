import { describe, expect, it } from "vitest";
import { normalizeText } from "../cellar";
import { composeDish } from "./compose";
import { FOOD, FOOD_KNOWLEDGE_VERSION, FOOD_PROVENANCE } from "./knowledge";
import { FOOD_AXES, FOOD_MAINS, FOOD_TAGS, type FoodStructure } from "./types";

const KINDS = {
  ingredient: FOOD.ingredients,
  technique: FOOD.techniques,
  sauce: FOOD.sauces,
  dish: FOOD.dishes,
} as const;

const inRange = (s: Partial<FoodStructure>, where: string) => {
  for (const [axis, value] of Object.entries(s) as [keyof FoodStructure, number][]) {
    expect(FOOD_AXES, `${where}: unknown axis ${axis}`).toContain(axis);
    const [lo, hi] = axis === "weight" || axis === "intensity" ? [1, 5] : [0, 3];
    expect(value, `${where}.${axis}`).toBeGreaterThanOrEqual(lo);
    expect(value, `${where}.${axis}`).toBeLessThanOrEqual(hi);
  }
};

describe("the food knowledge", () => {
  it("is a draft written for CELLR, with a version", () => {
    expect(FOOD_PROVENANCE).toEqual({ source: "cellr", reviewed: false });
    expect(FOOD_KNOWLEDGE_VERSION).toMatch(/^\d{4}\.\d+\.\d+$/);
  });

  it("has enough of everything", () => {
    expect(FOOD.ingredients.length).toBeGreaterThanOrEqual(200);
    expect(FOOD.sauces.length).toBeGreaterThanOrEqual(50);
    expect(FOOD.techniques.length).toBeGreaterThanOrEqual(22);
    expect(FOOD.dishes.length).toBeGreaterThanOrEqual(200);
  });

  it("has unique, kebab-case ids per kind", () => {
    for (const [kind, list] of Object.entries(KINDS)) {
      const ids = list.map((x) => x.id);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(dupes, kind).toEqual([]);
      for (const id of ids) expect(id, kind).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("names every entry in English and Dutch, in lower case", () => {
    for (const [kind, list] of Object.entries(KINDS))
      for (const x of list) {
        expect(x.en.length, `${kind} ${x.id} en`).toBeGreaterThan(0);
        expect(x.nl.length, `${kind} ${x.id} nl`).toBeGreaterThan(0);
        for (const name of [...x.en, ...x.nl]) {
          expect(name, `${kind} ${x.id}`).toBe(name.toLowerCase());
          expect(name.trim(), `${kind} ${x.id}`).toBe(name);
          expect(normalizeText(name), `${kind} ${x.id}: "${name}"`).not.toBe("");
        }
      }
  });

  it("never gives one normalised name to two entries of the same kind", () => {
    for (const [kind, list] of Object.entries(KINDS)) {
      const owner = new Map<string, string>();
      const clashes: string[] = [];
      for (const x of list)
        for (const name of new Set([...x.en, ...x.nl].map(normalizeText))) {
          const before = owner.get(name);
          if (before && before !== x.id) clashes.push(`"${name}": ${before} / ${x.id}`);
          owner.set(name, x.id);
        }
      expect(clashes, kind).toEqual([]);
    }
  });

  it("keeps every structure on its scale and every technique delta within ±2", () => {
    for (const i of FOOD.ingredients) inRange(i.s, `ingredient ${i.id}`);
    for (const s of FOOD.sauces) inRange(s.s, `sauce ${s.id}`);
    for (const d of FOOD.dishes) inRange(d.adjust ?? {}, `dish ${d.id}.adjust`);
    for (const t of FOOD.techniques)
      for (const [axis, delta] of Object.entries(t.delta)) {
        expect(FOOD_AXES, `technique ${t.id}`).toContain(axis);
        expect(Math.abs(delta), `technique ${t.id}.${axis}`).toBeLessThanOrEqual(2);
      }
  });

  it("uses only known tags, mains and dominance levels", () => {
    const tagged = [...FOOD.ingredients, ...FOOD.techniques, ...FOOD.sauces, ...FOOD.dishes];
    for (const x of tagged) for (const t of x.tags ?? []) expect(FOOD_TAGS, x.id).toContain(t);
    for (const i of FOOD.ingredients) if (i.main) expect(FOOD_MAINS, i.id).toContain(i.main);
    for (const d of FOOD.dishes) if (d.mainAs) expect(FOOD_MAINS, d.id).toContain(d.mainAs);
    for (const s of FOOD.sauces) expect([1, 2, 3], s.id).toContain(s.dominance);
  });

  it("builds every dish from parts that exist, on a main that can carry a dish", () => {
    const ingredients = new Map(FOOD.ingredients.map((i) => [i.id, i]));
    const techniques = new Set(FOOD.techniques.map((t) => t.id));
    const sauces = new Set(FOOD.sauces.map((s) => s.id));
    for (const d of FOOD.dishes) {
      expect(ingredients.has(d.main), `${d.id}.main ${d.main}`).toBe(true);
      if (d.technique) expect(techniques.has(d.technique), `${d.id}.technique`).toBe(true);
      if (d.sauce) expect(sauces.has(d.sauce), `${d.id}.sauce`).toBe(true);
      for (const w of d.with ?? []) expect(ingredients.has(w), `${d.id}.with ${w}`).toBe(true);
      expect(d.mainAs ?? ingredients.get(d.main)?.main, `${d.id} has no class`).toBeDefined();
      expect((d.classics ?? []).length, `${d.id} classics`).toBeLessThanOrEqual(5);
    }
  });

  it("composes every dish without throwing, into a structure on its scales", () => {
    for (const d of FOOD.dishes) {
      const p = composeDish(d, FOOD);
      expect(p.source).toBe("dish");
      expect(p.main, d.id).not.toBeNull();
      inRange(p.structure, `composed ${d.id}`);
    }
  });

  it("gives desserts sweetness and keeps savoury mains savoury", () => {
    for (const d of FOOD.dishes) {
      const p = composeDish(d, FOOD);
      if (p.main === "dessert") expect(p.structure.sweet, d.id).toBeGreaterThanOrEqual(2);
      if (["red-meat", "game", "white-fish", "oily-fish"].includes(p.main ?? ""))
        // A sweet glaze (teriyaki) may reach 2; more would make a main course a dessert.
        expect(p.structure.sweet, d.id).toBeLessThanOrEqual(2);
    }
  });
});
