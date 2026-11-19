import type {
  DishTemplate,
  FoodMain,
  FoodProfile,
  FoodStructure,
  FoodTag,
  Ingredient,
  Sauce,
  Technique,
} from "./types";

/** The knowledge the engine works from. The app's own is `FOOD` (./knowledge); tests may pass a small one. */
export interface FoodKnowledge {
  ingredients: readonly Ingredient[];
  techniques: readonly Technique[];
  sauces: readonly Sauce[];
  dishes: readonly DishTemplate[];
}

const FLAVOURS = [
  "fat",
  "acid",
  "sweet",
  "salt",
  "bitter",
  "umami",
  "heat",
  "spice",
  "smoke",
] as const;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

const base = (s: Partial<FoodStructure>): FoodStructure => ({
  weight: s.weight ?? 2,
  intensity: s.intensity ?? 2,
  fat: s.fat ?? 0,
  acid: s.acid ?? 0,
  sweet: s.sweet ?? 0,
  salt: s.salt ?? 0,
  bitter: s.bitter ?? 0,
  umami: s.umami ?? 0,
  heat: s.heat ?? 0,
  spice: s.spice ?? 0,
  smoke: s.smoke ?? 0,
});

/** Two sources of the same flavour: the stronger one counts, the weaker adds a little. */
const join = (a: number, b: number) => Math.max(a, b) + 0.25 * Math.min(a, b);

/** How much of a sauce's weight the dish takes on, by how much the sauce dominates. */
const SAUCE_PULL = { 1: 0.35, 2: 0.55, 3: 0.75 } as const;
const SAUCE_FLAVOUR = { 1: 0.75, 2: 1, 3: 1 } as const;

export interface DishParts {
  main: Ingredient | null;
  technique?: Technique | null;
  sauce?: Sauce | null;
  /** Everything else on the plate that matters, strongest influence first. */
  extras?: readonly Ingredient[];
  /** Further sauces and techniques named beside the first ones. */
  moreSauces?: readonly Sauce[];
  moreTechniques?: readonly Technique[];
  adjust?: Partial<FoodStructure> | undefined;
  mainAs?: FoodMain | undefined;
  tags?: readonly FoodTag[] | undefined;
}

/**
 * The structure of a dish from its parts: the main ingredient sets the base, the technique shifts it, the other
 * ingredients add their flavours, and the sauce pulls weight and flavour towards itself by its dominance.
 */
export function composeStructure(parts: DishParts): { structure: FoodStructure; tags: FoodTag[] } {
  const tags = new Set<FoodTag>(parts.tags ?? []);
  const s = base(parts.main?.s ?? {});
  for (const t of parts.main?.tags ?? []) tags.add(t);

  for (const technique of [parts.technique, ...(parts.moreTechniques ?? [])]) {
    if (!technique) continue;
    for (const [axis, delta] of Object.entries(technique.delta) as [keyof FoodStructure, number][])
      s[axis] += delta;
    for (const t of technique.tags ?? []) tags.add(t);
  }

  for (const extra of parts.extras ?? []) {
    for (const axis of FLAVOURS) s[axis] = join(s[axis], extra.s[axis] ?? 0);
    // A rich side makes the plate a little heavier; a light one does not make it lighter.
    s.weight += Math.max(0, (extra.s.weight ?? 2) - s.weight) * 0.3;
    s.intensity = Math.max(s.intensity, (extra.s.intensity ?? 2) - 0.5);
    for (const t of extra.tags ?? []) tags.add(t);
  }

  for (const sauce of [parts.sauce, ...(parts.moreSauces ?? [])]) {
    if (!sauce) continue;
    const pull = SAUCE_PULL[sauce.dominance];
    const sauceWeight = sauce.s.weight ?? 2;
    // A rich sauce makes a light dish richer by most of the difference; a light sauce lightens only a little.
    s.weight += (sauceWeight - s.weight) * (sauceWeight > s.weight ? pull : pull * 0.3);
    s.intensity = Math.max(
      s.intensity,
      (sauce.s.intensity ?? 2) * (sauce.dominance === 1 ? 0.85 : 1),
    );
    for (const axis of FLAVOURS)
      s[axis] = join(s[axis], (sauce.s[axis] ?? 0) * SAUCE_FLAVOUR[sauce.dominance]);
    for (const t of sauce.tags ?? []) tags.add(t);
  }

  if (parts.adjust)
    for (const [axis, value] of Object.entries(parts.adjust) as [keyof FoodStructure, number][])
      s[axis] = value;

  s.weight = round1(clamp(s.weight, 1, 5));
  s.intensity = round1(clamp(s.intensity, 1, 5));
  for (const axis of FLAVOURS) s[axis] = round1(clamp(s[axis], 0, 3));
  return { structure: s, tags: [...tags] };
}

const byId = <T extends { id: string }>(
  list: readonly T[],
  id: string | undefined,
  what: string,
): T | null => {
  if (id === undefined) return null;
  const found = list.find((x) => x.id === id);
  if (!found) throw new Error(`food knowledge: unknown ${what} "${id}"`);
  return found;
};

/** The parts a template names, looked up. Throws on an id that does not exist (the knowledge tests catch that). */
export function templateParts(dish: DishTemplate, k: FoodKnowledge): DishParts {
  return {
    main: byId(k.ingredients, dish.main, "ingredient"),
    technique: byId(k.techniques, dish.technique, "technique"),
    sauce: byId(k.sauces, dish.sauce, "sauce"),
    extras: (dish.with ?? []).map((id) => byId(k.ingredients, id, "ingredient")!),
    adjust: dish.adjust,
    mainAs: dish.mainAs,
    tags: dish.tags,
  };
}

/** A known dish as a profile, with nothing else said about it. */
export function composeDish(dish: DishTemplate, k: FoodKnowledge): FoodProfile {
  const parts = templateParts(dish, k);
  const { structure, tags } = composeStructure(parts);
  return {
    source: "dish",
    dishId: dish.id,
    label: { en: dish.en[0]!, nl: dish.nl[0] ?? dish.en[0]! },
    main: dish.mainAs ?? parts.main?.main ?? null,
    structure,
    tags,
    classics: [...(dish.classics ?? [])],
    parts: {
      ingredients: [dish.main, ...(dish.with ?? [])],
      techniques: dish.technique ? [dish.technique] : [],
      sauces: dish.sauce ? [dish.sauce] : [],
    },
    unknown: [],
    confidence: "high",
  };
}
