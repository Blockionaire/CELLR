import { z } from "zod";
import { composeStructure, type DishParts, type FoodKnowledge } from "./compose";
import { composedClassics } from "./parse";
import {
  FOOD_MAINS,
  FOOD_TAGS,
  type FoodMain,
  type FoodProfile,
  type FoodStructure,
  type FoodTag,
  type Ingredient,
  type Sauce,
  type Technique,
} from "./types";

/**
 * A DISH READ BY A MODEL, CHECKED BY CODE. When the parser shows it may have misread a dish (`routeDishReading`),
 * a model is asked to describe it in the food engine's own vocabulary: the class of the dish, which of the known
 * ingredients, techniques and sauces it is made of, and the dish's structure on the engine's scales. Nothing it
 * says about wine is asked for or used. Its answer is held to a strict schema, then checked here against the
 * knowledge: an id the knowledge does not have is dropped, a scale out of range is refused, and a model that does
 * not recognise the dish says so ("unknown" stays unknown). What the person said themselves (a sauce, a way of
 * cooking, a side) is never dropped: the model's reading is added to the parser's, not put in its place.
 *
 * Bump `DISH_READING_VERSION` with any change to the schema, the prompt or the merge: cached readings carry it.
 */
export const DISH_READING_VERSION = 1;

const AXIS = (lo: number, hi: number) => z.number().min(lo).max(hi).nullable();

/** The model's answer, as the schema holds it to. Ids are checked against the knowledge afterwards. */
export const RawDishReadingSchema = z
  .object({
    recognised: z.boolean(),
    main: z.enum([...FOOD_MAINS, "unknown"]),
    main_ingredient: z.string().max(60).nullable(),
    ingredients: z.array(z.string().max(60)).max(8),
    techniques: z.array(z.string().max(60)).max(3),
    sauces: z.array(z.string().max(60)).max(3),
    structure: z
      .object({
        weight: AXIS(1, 5),
        intensity: AXIS(1, 5),
        fat: AXIS(0, 3),
        acid: AXIS(0, 3),
        sweet: AXIS(0, 3),
        salt: AXIS(0, 3),
        bitter: AXIS(0, 3),
        umami: AXIS(0, 3),
        heat: AXIS(0, 3),
        spice: AXIS(0, 3),
        smoke: AXIS(0, 3),
      })
      .strict(),
    tags: z.array(z.string().max(40)).max(10),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .strict();
export type RawDishReading = z.infer<typeof RawDishReadingSchema>;

/** A reading after the check: only what the knowledge has, and nothing at all for a dish the model did not know. */
export type DishReading =
  | { recognised: false }
  | {
      recognised: true;
      main: FoodMain;
      mainIngredient: string | null;
      ingredients: string[];
      techniques: string[];
      sauces: string[];
      structure: Partial<FoodStructure>;
      tags: FoodTag[];
      confidence: "high" | "medium" | "low";
      /** Ids the model named that the knowledge does not have, and were dropped. */
      dropped: number;
    };

const TAGS: ReadonlySet<string> = new Set(FOOD_TAGS);

/**
 * The model's answer checked against the knowledge. Throws on an answer outside the schema (the provider then
 * treats it as invalid). A reading in which most named parts do not exist is a made-up reading: not recognised.
 */
export function checkDishReading(value: unknown, k: FoodKnowledge): DishReading {
  const raw = RawDishReadingSchema.parse(value);
  if (!raw.recognised || raw.main === "unknown") return { recognised: false };
  const ids = (list: readonly { id: string }[]) => new Set(list.map((x) => x.id));
  const known = { i: ids(k.ingredients), t: ids(k.techniques), s: ids(k.sauces) };
  let named = 0;
  let dropped = 0;
  const keep = (wanted: readonly string[], has: ReadonlySet<string>) => {
    const out: string[] = [];
    for (const id of wanted) {
      named += 1;
      if (has.has(id)) {
        if (!out.includes(id)) out.push(id);
      } else dropped += 1;
    }
    return out;
  };
  const mainIngredient =
    raw.main_ingredient === null ? null : (keep([raw.main_ingredient], known.i)[0] ?? null);
  const ingredients = keep(raw.ingredients, known.i).filter((id) => id !== mainIngredient);
  const techniques = keep(raw.techniques, known.t);
  const sauces = keep(raw.sauces, known.s);
  // Nothing of it exists in the knowledge, or more made up than real: the model did not know this dish.
  if (named > 0 && dropped * 2 > named) return { recognised: false };
  const structure: Partial<FoodStructure> = {};
  for (const [axis, v] of Object.entries(raw.structure) as Array<
    [keyof FoodStructure, number | null]
  >)
    if (v !== null) structure[axis] = v;
  return {
    recognised: true,
    main: raw.main,
    mainIngredient,
    ingredients: ingredients.slice(0, 6),
    techniques,
    sauces,
    structure,
    tags: raw.tags.filter((t): t is FoodTag => TAGS.has(t)),
    confidence: raw.confidence,
    dropped,
  };
}

const find = <T extends { id: string }>(list: readonly T[], id: string | undefined | null) =>
  id ? (list.find((x) => x.id === id) ?? null) : null;

/**
 * The parser's reading and the model's, as one profile for the pairing engine.
 *
 * - What the person wrote and the parser recognised (sauces, techniques, sides) is always kept.
 * - The model decides what the dish is built on and its class: that is what the parser could not tell.
 * - The structure is composed from the parts by the knowledge, as for any dish; a scale the model states replaces
 *   the composed one (it read the dish as a whole: a sweet marinade, a long braise).
 * - A model reading is never "sure": at most "medium", so that an answer built on it never sounds certain.
 * - A dish the model did not recognise leaves the parser's reading as it was, marked "low" when it was a guess.
 */
export function mergeDishReading(
  parsed: FoodProfile,
  reading: DishReading,
  k: FoodKnowledge,
  said: string | null,
): FoodProfile {
  if (!reading.recognised)
    return parsed.main === null ? parsed : { ...parsed, confidence: "low", readBy: "parser" };
  // The model agrees with a dish the parser recognised by name: the parser's reading stands as it was (the
  // template's classics and structure), now confirmed.
  if (parsed.dishId !== null && parsed.main === reading.main) return { ...parsed, readBy: "model" };
  const parsedMain = parsed.parts.ingredients[0] ?? null;
  const mainId = reading.mainIngredient ?? parsedMain;
  const main = find(k.ingredients, mainId) as Ingredient | null;
  const extraIds = [...parsed.parts.ingredients, ...reading.ingredients].filter(
    (id, i, all) => id !== mainId && all.indexOf(id) === i,
  );
  const extras = extraIds
    .map((id) => find(k.ingredients, id))
    .filter((x): x is Ingredient => x !== null)
    .slice(0, 6);
  const techniqueIds = [...new Set([...parsed.parts.techniques, ...reading.techniques])];
  const sauceIds = [...new Set([...parsed.parts.sauces, ...reading.sauces])];
  const techniques = techniqueIds
    .map((id) => find(k.techniques, id))
    .filter((x): x is Technique => x !== null);
  const sauces = sauceIds.map((id) => find(k.sauces, id)).filter((x): x is Sauce => x !== null);
  const parts: DishParts = {
    main,
    technique: techniques[0] ?? null,
    sauce: sauces[0] ?? null,
    extras,
    moreTechniques: techniques.slice(1),
    moreSauces: sauces.slice(1),
    mainAs: reading.main,
    tags: [...new Set([...parsed.tags, ...reading.tags])],
  };
  const composed = composeStructure(parts);
  const structure = { ...composed.structure };
  for (const [axis, v] of Object.entries(reading.structure) as Array<[keyof FoodStructure, number]>)
    structure[axis] = v;
  const word = (x: { en: readonly string[]; nl: readonly string[] } | null, lang: "en" | "nl") =>
    x ? ((lang === "nl" ? x.nl[0] : x.en[0]) ?? x.en[0] ?? "") : "";
  // Named after what the model says it is built on, when that is not what the parser thought.
  const rebuilt = reading.mainIngredient !== null && reading.mainIngredient !== parsedMain;
  const label = (lang: "en" | "nl") =>
    parsed.main !== null && !rebuilt
      ? parsed.label[lang]
      : [word(techniques[0] ?? null, lang), word(main, lang)].filter(Boolean).join(" ") ||
        (said ?? parsed.label[lang]);
  return {
    source: parsed.source === "dish" ? "dish" : "composed",
    dishId: parsed.dishId,
    label: { en: label("en"), nl: label("nl") },
    // The phrase the model read: kept in the conversation's state, so a follow-up finds the same reading.
    said: said ?? parsed.said,
    main: reading.main,
    structure,
    tags: composed.tags,
    // A dish recognised by name keeps its own classics whatever the model says it is built on: they belong to
    // the dish that was named.
    classics: parsed.dishId !== null ? parsed.classics : composedClassics(main, extras),
    parts: {
      ingredients: [...(main ? [main.id] : []), ...extras.map((x) => x.id)],
      techniques: techniques.map((x) => x.id),
      sauces: sauces.map((x) => x.id),
    },
    unknown: [],
    confidence: reading.confidence === "low" ? "low" : "medium",
    readBy: "model",
  };
}

/** The strict JSON schema the model's answer is held to, with the knowledge's ids as closed lists. */
export function dishReadingJsonSchema(k: FoodKnowledge): Record<string, unknown> {
  const axis = (lo: number, hi: number) => ({
    anyOf: [{ type: "number", minimum: lo, maximum: hi }, { type: "null" }],
  });
  const idOf = (list: readonly { id: string }[]) => ({
    type: "string",
    enum: list.map((x) => x.id),
  });
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "recognised",
      "main",
      "main_ingredient",
      "ingredients",
      "techniques",
      "sauces",
      "structure",
      "tags",
      "confidence",
    ],
    properties: {
      recognised: { type: "boolean" },
      main: { type: "string", enum: [...FOOD_MAINS, "unknown"] },
      main_ingredient: { anyOf: [idOf(k.ingredients), { type: "null" }] },
      ingredients: { type: "array", items: idOf(k.ingredients), maxItems: 8 },
      techniques: { type: "array", items: idOf(k.techniques), maxItems: 3 },
      sauces: { type: "array", items: idOf(k.sauces), maxItems: 3 },
      structure: {
        type: "object",
        additionalProperties: false,
        required: [
          "weight",
          "intensity",
          "fat",
          "acid",
          "sweet",
          "salt",
          "bitter",
          "umami",
          "heat",
          "spice",
          "smoke",
        ],
        properties: {
          weight: axis(1, 5),
          intensity: axis(1, 5),
          fat: axis(0, 3),
          acid: axis(0, 3),
          sweet: axis(0, 3),
          salt: axis(0, 3),
          bitter: axis(0, 3),
          umami: axis(0, 3),
          heat: axis(0, 3),
          spice: axis(0, 3),
          smoke: axis(0, 3),
        },
      },
      tags: { type: "array", items: { type: "string", enum: [...FOOD_TAGS] }, maxItems: 10 },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
  };
}
