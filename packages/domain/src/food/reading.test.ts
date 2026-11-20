import { describe, expect, it } from "vitest";
import { FOOD } from "./knowledge";
import { parseFood } from "./parse";
import {
  checkDishReading,
  dishReadingJsonSchema,
  mergeDishReading,
  type RawDishReading,
} from "./reading";
import { dishPhrase, routeDishReading } from "./route";

const NONE = {
  weight: null,
  intensity: null,
  fat: null,
  acid: null,
  sweet: null,
  salt: null,
  bitter: null,
  umami: null,
  heat: null,
  spice: null,
  smoke: null,
};
const ids = (list: readonly { id: string }[]) => new Set(list.map((x) => x.id));
const anIngredient = (main: string) => FOOD.ingredients.find((i) => i.main === main)!.id;
const raw = (over: Partial<RawDishReading> = {}): RawDishReading => ({
  recognised: true,
  main: "pork",
  main_ingredient: anIngredient("pork"),
  ingredients: [],
  techniques: [],
  sauces: [],
  structure: { ...NONE },
  tags: [],
  confidence: "high",
  ...over,
});

describe("checking a model's reading of a dish", () => {
  it("keeps only what the knowledge has", () => {
    const r = checkDishReading(
      raw({ ingredients: [anIngredient("vegetable"), "unicorn-meat"], tags: ["not-a-tag"] }),
      FOOD,
    );
    expect(r.recognised).toBe(true);
    if (!r.recognised) return;
    expect(r.ingredients).toEqual([anIngredient("vegetable")]);
    expect(r.tags).toEqual([]);
    expect(r.dropped).toBe(1);
  });

  it("a reading made up for the most part is not a reading", () => {
    expect(
      checkDishReading(
        raw({
          main_ingredient: "dragon",
          ingredients: ["phoenix", "griffin", anIngredient("pork")],
        }),
        FOOD,
      ),
    ).toEqual({ recognised: false });
  });

  it("unknown stays unknown", () => {
    expect(checkDishReading(raw({ recognised: false }), FOOD)).toEqual({ recognised: false });
    expect(checkDishReading(raw({ main: "unknown" }), FOOD)).toEqual({ recognised: false });
  });

  it("refuses an answer outside the schema: a scale out of range, an extra field, a missing one", () => {
    expect(() => checkDishReading(raw({ structure: { ...NONE, heat: 7 } }), FOOD)).toThrow();
    expect(() => checkDishReading({ ...raw(), wine: "Barolo" }, FOOD)).toThrow();
    const { confidence: _, ...missing } = raw();
    expect(() => checkDishReading(missing, FOOD)).toThrow();
  });

  it("the strict schema lists only the knowledge's ids and the engine's scales", () => {
    const schema = dishReadingJsonSchema(FOOD) as {
      properties: { ingredients: { items: { enum: string[] } } };
      additionalProperties: boolean;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(new Set(schema.properties.ingredients.items.enum)).toEqual(ids(FOOD.ingredients));
  });
});

describe("the parser's reading and the model's, as one", () => {
  it("keeps what the person said (a sauce, a way of cooking) and takes the model's class of the dish", () => {
    const parsed = parseFood("zuurkool met casselerrib uit de oven", FOOD);
    const sauce = FOOD.sauces[0]!.id;
    const merged = mergeDishReading(
      parsed,
      checkDishReading(raw({ sauces: [sauce], structure: { ...NONE, salt: 3 } }), FOOD),
      FOOD,
      "zuurkool met casselerrib uit de oven",
    );
    expect(merged.main).toBe("pork");
    for (const t of parsed.parts.techniques) expect(merged.parts.techniques).toContain(t);
    for (const i of parsed.parts.ingredients) expect(merged.parts.ingredients).toContain(i);
    expect(merged.parts.sauces).toContain(sauce);
    expect(merged.structure.salt).toBe(3);
    expect(merged.readBy).toBe("model");
  });

  it("a model reading is never sure", () => {
    const parsed = parseFood("bulgogi", FOOD);
    for (const confidence of ["high", "medium"] as const)
      expect(
        mergeDishReading(parsed, checkDishReading(raw({ confidence }), FOOD), FOOD, "bulgogi")
          .confidence,
      ).toBe("medium");
    expect(
      mergeDishReading(parsed, checkDishReading(raw({ confidence: "low" }), FOOD), FOOD, "x")
        .confidence,
    ).toBe("low");
  });

  it("a dish the model does not know leaves the parser's reading, marked a guess; nothing stays nothing", () => {
    const guessed = parseFood("casselerrib met zuurkool", FOOD);
    const kept = mergeDishReading(guessed, { recognised: false }, FOOD, "casselerrib met zuurkool");
    expect(kept.main).toBe(guessed.main);
    if (guessed.main !== null) expect(kept.confidence).toBe("low");
    const nothing = parseFood("blorptang", FOOD);
    expect(mergeDishReading(nothing, { recognised: false }, FOOD, "blorptang")).toEqual(nothing);
  });

  it("names no wine: the classics come from the knowledge, never from the model", () => {
    const merged = mergeDishReading(
      parseFood("blorptang", FOOD),
      checkDishReading(raw(), FOOD),
      FOOD,
      "blorptang",
    );
    const main = FOOD.ingredients.find((i) => i.id === anIngredient("pork"))!;
    expect(merged.classics).toEqual([...(main.classics ?? [])]);
  });
});

describe("when a dish goes to a model", () => {
  it("a dish the parser knows in full stays with the parser", () => {
    expect(routeDishReading(parseFood("roast lamb", FOOD)).read).toBe(false);
  });
  it("words around the dish are not a sign of a misread dish", () => {
    const r = routeDishReading(parseFood("Roast lamb tonight for my in-laws, under 30 euro", FOOD));
    expect(r.unread).toEqual([]);
  });
  it("a question with no food in it at all does not go to a model", () => {
    expect(routeDishReading(parseFood("Under 30, online is fine.", FOOD)).read).toBe(false);
  });
  it("an unknown dish word does", () => {
    const r = routeDishReading(parseFood("Zuurkool met casselerrib, welke wijn?", FOOD));
    expect(r.read).toBe(true);
  });
});

describe("the dish phrase a model sees", () => {
  it.each([
    ["Zuurkool met casselerrib vanavond, welke wijn? Max 20 euro", "zuurkool met casselerrib"],
    ["What do I open with roast chicken?", "roast chicken"],
    ["@lotte komt eten, we hebben zeebaars", "zeebaars"],
    ["Bulgogi for my dad and the kids tonight", "bulgogi"],
  ])("%s → %s", (question, phrase) => expect(dishPhrase(question)).toBe(phrase));

  it("never holds a name, a number or a price", () => {
    const p = dishPhrase("Stoofvlees voor @jan.de.vries en 6 gasten, €45, 06-12345678") ?? "";
    expect(p).not.toMatch(/jan|vries|@|\d|€/);
  });

  it("is short, and nothing when nothing of a dish is left", () => {
    expect(dishPhrase("What wine tonight?")).toBeNull();
    expect(
      (dishPhrase("a ".repeat(400) + "lamb ".repeat(400)) ?? "").split(" ").length,
    ).toBeLessThanOrEqual(12);
  });
});
