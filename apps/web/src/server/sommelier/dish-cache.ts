import "server-only";
import { createHash } from "node:crypto";
import {
  DISH_READING_VERSION,
  FOOD,
  FOOD_MAINS,
  FOOD_TAGS,
  RawDishReadingSchema,
  type DishReading,
} from "@cellr/domain/intelligence";

/**
 * SHARED DISH READINGS. A model's reading of a dish is not about the person who asked: "zuurkool met casselerrib"
 * is the same dish for everyone. So a reading may be kept and given to the next person who asks about the same
 * dish, and the second question costs nothing. What makes that safe (docs/sprints/sommelier-3-mega/DISH_CACHE.md):
 *
 * - The key is made of the dish phrase alone (`dishPhrase`: no names, numbers, prices, occasion, people or
 *   asking words), and the model is shown exactly that phrase, so a reading is a function of the key and of
 *   nothing else a person said. Nothing about the asker can be in it.
 * - What is kept is the checked reading: a class, ids from the knowledge, numbers on fixed scales. No text from
 *   the person or the model. The key is stored only as a hash.
 * - The key carries every version the reading depends on (the reading's schema, the prompt, the model, the
 *   knowledge's ids): a change to any of them is a new key, and the old reading is never used again.
 * - A reading expires (TTL), and an unrecognised dish expires sooner (a new model may know it).
 *
 * This store is in the memory of one server instance: it is shared by everyone that instance serves and is lost
 * with it. A store shared by every instance is designed in DISH_CACHE.md and not built.
 */
export interface DishReadingCache {
  get(key: string): DishReading | null;
  set(key: string, reading: DishReading): void;
}

export const DISH_CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
export const DISH_CACHE_UNRECOGNISED_TTL_MS = 24 * 3600 * 1000;
export const DISH_CACHE_MAX_ENTRIES = 5000;

/** The ids of the food knowledge, as one short hash: a change to the knowledge changes every key. */
let knowledgeHash: string | null = null;
const knowledgeVersion = () =>
  (knowledgeHash ??= createHash("sha256")
    .update(
      [
        ...FOOD.ingredients.map((x) => `i:${x.id}`),
        ...FOOD.techniques.map((x) => `t:${x.id}`),
        ...FOOD.sauces.map((x) => `s:${x.id}`),
        // The closed lists of the reading itself: a new class or tag changes what a reading can say.
        ...FOOD_MAINS.map((x) => `m:${x}`),
        ...FOOD_TAGS.map((x) => `g:${x}`),
      ]
        .sort()
        .join(","),
    )
    .digest("hex")
    .slice(0, 16));

/** The key a reading of this phrase is kept under: a hash, never the phrase itself. */
export function dishCacheKey(phrase: string, model: string, promptVersion: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify([DISH_READING_VERSION, promptVersion, model, knowledgeVersion(), phrase]),
    )
    .digest("hex");
}

/** A reading may only be kept if it has nothing in it but the checked fields: no free text, no extra keys. */
function storable(reading: DishReading): DishReading | null {
  if (!reading.recognised) return { recognised: false };
  // Re-validate the shape through the raw schema's own rules (ids are strings of the knowledge, scales numbers).
  const ok = RawDishReadingSchema.safeParse({
    recognised: true,
    main: reading.main,
    main_ingredient: reading.mainIngredient,
    ingredients: reading.ingredients,
    techniques: reading.techniques,
    sauces: reading.sauces,
    structure: {
      weight: reading.structure.weight ?? null,
      intensity: reading.structure.intensity ?? null,
      fat: reading.structure.fat ?? null,
      acid: reading.structure.acid ?? null,
      sweet: reading.structure.sweet ?? null,
      salt: reading.structure.salt ?? null,
      bitter: reading.structure.bitter ?? null,
      umami: reading.structure.umami ?? null,
      heat: reading.structure.heat ?? null,
      spice: reading.structure.spice ?? null,
      smoke: reading.structure.smoke ?? null,
    },
    tags: reading.tags,
    confidence: reading.confidence,
  });
  if (!ok.success) return null;
  return {
    recognised: true,
    main: reading.main,
    mainIngredient: reading.mainIngredient,
    ingredients: [...reading.ingredients],
    techniques: [...reading.techniques],
    sauces: [...reading.sauces],
    structure: { ...reading.structure },
    tags: [...reading.tags],
    confidence: reading.confidence,
    dropped: reading.dropped,
  };
}

/** The in-memory store: least recently used out first, each entry with its own expiry. */
export function createMemoryDishCache(
  options: { now?: () => number; maxEntries?: number } = {},
): DishReadingCache {
  const now = options.now ?? Date.now;
  const max = options.maxEntries ?? DISH_CACHE_MAX_ENTRIES;
  const entries = new Map<string, { reading: DishReading; until: number }>();
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return null;
      if (hit.until <= now()) {
        entries.delete(key);
        return null;
      }
      // Most recently used last.
      entries.delete(key);
      entries.set(key, hit);
      return hit.reading;
    },
    set(key, reading) {
      const kept = storable(reading);
      if (!kept) return;
      entries.delete(key);
      entries.set(key, {
        reading: kept,
        until: now() + (kept.recognised ? DISH_CACHE_TTL_MS : DISH_CACHE_UNRECOGNISED_TTL_MS),
      });
      while (entries.size > max) entries.delete(entries.keys().next().value!);
    },
  };
}

/** One store per server instance. */
let shared: DishReadingCache | null = null;
export const sharedDishCache = () => (shared ??= createMemoryDishCache());
