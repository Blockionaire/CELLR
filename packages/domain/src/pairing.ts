import { normalizeText, type WineType } from "./cellar";
import { styleOf, type WineStyle } from "./drink-window";

/**
 * FOOD AND WINE as a score, not a lookup table. Every dish has a taste profile (how much body it can take,
 * whether it wants tannin, acidity, sweetness) and every wine gets the same kind of profile from its colour
 * and the style of its region. The closer the two, the better the match. So even a wine nobody wrote down
 * gets a sensible answer. Carried over from the old Wijnkelder app, in English.
 */

/** Every dish, by id (the screens translate the name and the tip from it). */
export const DISH_IDS = [
  "steak",
  "stew",
  "lamb",
  "game",
  "barbecue",
  "burger",
  "charcuterie",
  "chicken",
  "duck",
  "festive-bird",
  "pork",
  "pork-belly",
  "white-fish",
  "oily-fish",
  "shellfish",
  "smoked-fish",
  "fish-soup",
  "pasta-tomato",
  "pasta-cream",
  "ragu",
  "risotto",
  "pizza",
  "salad",
  "roasted-veg",
  "mushrooms",
  "quiche",
  "pulses",
  "veggie-burger",
  "sushi",
  "thai",
  "curry",
  "chinese",
  "hard-cheese",
  "soft-cheese",
  "blue-cheese",
  "goat-cheese",
  "chocolate",
  "fruit-tart",
  "custard",
  "ice-cream",
  "aperitif",
  "nuts",
  "fries",
  "soup",
  "eggs",
  "spicy",
] as const;
export type DishId = (typeof DISH_IDS)[number];

/** Words the screen translates. */
export const DISH_GROUPS = [
  "red-meat",
  "poultry",
  "pork",
  "fish",
  "pasta-rice",
  "vegetarian",
  "asian",
  "cheese",
  "dessert",
  "snacks",
  "other",
] as const;
export type DishGroup = (typeof DISH_GROUPS)[number];

/** [ideal, tolerance] on a 0–5 scale. */
type Target = readonly [ideal: number, tolerance: number];

export interface Dish {
  id: DishId;
  group: DishGroup;
  /** How well each colour suits the dish (0–1). A colour not listed barely fits. */
  weights: Partial<Record<WineType, number>>;
  body: Target;
  tannin: Target;
  acidity: Target;
  sweetness: Target;
  /** Regions that are classic with it. */
  styles: readonly WineStyle[];
}

const dish = (
  id: DishId,
  group: DishGroup,
  weights: Dish["weights"],
  body: Target,
  tannin: Target,
  acidity: Target,
  sweetness: Target,
  styles: readonly WineStyle[] = [],
): Dish => ({ id, group, weights, body, tannin, acidity, sweetness, styles });

export const DISHES: readonly Dish[] = [
  // Red meat
  dish(
    "steak",
    "red-meat",
    { red: 1, rose: 0.2 },
    [4.5, 1.2],
    [4.5, 1.3],
    [3.5, 1.5],
    [0, 0.8],
    ["bordeaux", "ribera", "argentina", "california", "tuscany"],
  ),
  dish(
    "stew",
    "red-meat",
    { red: 1 },
    [4, 1.3],
    [3.5, 1.5],
    [3.5, 1.3],
    [0, 0.8],
    ["rhone-south", "rioja", "languedoc", "italy-south"],
  ),
  dish(
    "lamb",
    "red-meat",
    { red: 1 },
    [4, 1.2],
    [4, 1.3],
    [3.5, 1.3],
    [0, 0.8],
    ["bordeaux", "rhone-north", "rioja", "priorat", "tuscany"],
  ),
  dish(
    "game",
    "red-meat",
    { red: 1 },
    [4.5, 1.2],
    [4, 1.4],
    [4, 1.3],
    [0, 0.9],
    ["burgundy", "rhone-north", "piedmont", "austria"],
  ),
  dish(
    "barbecue",
    "red-meat",
    { red: 1, rose: 0.4 },
    [4.5, 1.3],
    [3.5, 1.5],
    [3, 1.5],
    [0.5, 1],
    ["australia", "italy-south", "argentina", "south-africa"],
  ),
  dish(
    "burger",
    "red-meat",
    { red: 1, rose: 0.3 },
    [4, 1.4],
    [3, 1.6],
    [3.5, 1.5],
    [0.5, 1],
    ["california", "argentina", "italy-south"],
  ),
  dish(
    "charcuterie",
    "red-meat",
    { red: 0.9, rose: 0.7, white: 0.4, sparkling: 0.5 },
    [3, 1.5],
    [2.5, 1.6],
    [4, 1.3],
    [0, 1],
    ["beaujolais", "loire", "piedmont", "spain-white"],
  ),
  // Poultry
  dish(
    "chicken",
    "poultry",
    { white: 1, red: 0.8, rose: 0.6, sparkling: 0.5 },
    [3.5, 1.4],
    [2, 1.8],
    [3.5, 1.4],
    [0, 1],
    ["burgundy", "rhone-south", "california"],
  ),
  dish(
    "duck",
    "poultry",
    { red: 1, white: 0.4 },
    [4, 1.3],
    [3.5, 1.5],
    [4, 1.2],
    [0.5, 1.2],
    ["burgundy", "southwest", "rhone-north", "piedmont"],
  ),
  dish(
    "festive-bird",
    "poultry",
    { red: 0.9, white: 0.9, sparkling: 0.5 },
    [3.5, 1.4],
    [2.5, 1.6],
    [3.5, 1.4],
    [0, 1],
    ["burgundy", "alsace"],
  ),
  // Pork
  dish(
    "pork",
    "pork",
    { red: 0.9, white: 0.8, rose: 0.6 },
    [3.5, 1.4],
    [2.5, 1.6],
    [3.5, 1.4],
    [0.5, 1.2],
    ["loire", "alsace", "burgundy", "piedmont"],
  ),
  dish(
    "pork-belly",
    "pork",
    { white: 0.9, red: 0.8, sparkling: 0.7 },
    [3, 1.5],
    [2, 1.7],
    [4.5, 1.1],
    [0.5, 1.2],
    ["loire", "riesling", "beaujolais"],
  ),
  // Fish
  dish(
    "white-fish",
    "fish",
    { white: 1, sparkling: 0.7, rose: 0.4 },
    [2.5, 1.3],
    [0, 0.6],
    [4, 1.2],
    [0, 0.8],
    ["loire", "burgundy", "spain-white", "greece"],
  ),
  dish(
    "oily-fish",
    "fish",
    { white: 1, rose: 0.8, red: 0.5, sparkling: 0.5 },
    [3.5, 1.3],
    [1, 1.4],
    [4, 1.2],
    [0, 1],
    ["burgundy", "california", "alsace", "austria"],
  ),
  dish(
    "shellfish",
    "fish",
    { white: 1, sparkling: 0.9, rose: 0.4 },
    [2.5, 1.2],
    [0, 0.5],
    [4.5, 1.1],
    [0, 0.8],
    ["loire", "burgundy", "spain-white", "cava", "champagne"],
  ),
  dish(
    "smoked-fish",
    "fish",
    { white: 1, sparkling: 0.8 },
    [3, 1.3],
    [0, 0.6],
    [4.5, 1.1],
    [1, 1.3],
    ["riesling", "austria", "alsace", "champagne"],
  ),
  dish(
    "fish-soup",
    "fish",
    { white: 1, rose: 0.9 },
    [3, 1.3],
    [0, 0.7],
    [4, 1.2],
    [0, 0.9],
    ["provence", "rhone-south", "languedoc"],
  ),
  // Pasta & rice
  dish(
    "pasta-tomato",
    "pasta-rice",
    { red: 1, rose: 0.5 },
    [3, 1.4],
    [2.5, 1.5],
    [4.5, 1],
    [0, 0.9],
    ["tuscany", "piedmont", "italy-south"],
  ),
  dish(
    "pasta-cream",
    "pasta-rice",
    { white: 1, sparkling: 0.5 },
    [3.5, 1.3],
    [0, 0.7],
    [4, 1.2],
    [0, 0.9],
    ["burgundy", "veneto", "italy-white"],
  ),
  dish(
    "ragu",
    "pasta-rice",
    { red: 1 },
    [3.5, 1.3],
    [3, 1.5],
    [4.5, 1.1],
    [0, 0.9],
    ["tuscany", "piedmont", "italy-south"],
  ),
  dish(
    "risotto",
    "pasta-rice",
    { white: 1, red: 0.5, sparkling: 0.5 },
    [3.5, 1.3],
    [1, 1.3],
    [4, 1.2],
    [0, 0.9],
    ["piedmont", "veneto", "burgundy"],
  ),
  dish(
    "pizza",
    "pasta-rice",
    { red: 1, rose: 0.6, sparkling: 0.4 },
    [3, 1.5],
    [2.5, 1.6],
    [4.5, 1.1],
    [0, 1],
    ["tuscany", "italy-south"],
  ),
  // Vegetarian
  dish(
    "salad",
    "vegetarian",
    { white: 1, rose: 0.8, sparkling: 0.6 },
    [2, 1.2],
    [0, 0.6],
    [4.5, 1.1],
    [0, 0.8],
    ["loire", "austria", "new-zealand", "provence"],
  ),
  dish(
    "roasted-veg",
    "vegetarian",
    { red: 0.8, white: 0.9, rose: 0.8, orange: 0.8 },
    [3, 1.4],
    [2, 1.6],
    [3.5, 1.4],
    [0, 1],
    ["rhone-south", "provence", "languedoc", "italy-south"],
  ),
  dish(
    "mushrooms",
    "vegetarian",
    { red: 1, white: 0.7, orange: 0.6 },
    [3.5, 1.3],
    [3, 1.5],
    [4, 1.2],
    [0, 0.9],
    ["piedmont", "burgundy", "jura"],
  ),
  dish(
    "quiche",
    "vegetarian",
    { white: 1, rose: 0.7, sparkling: 0.6, red: 0.5 },
    [3, 1.4],
    [1, 1.4],
    [4, 1.2],
    [0, 1],
    ["alsace", "loire", "burgundy"],
  ),
  dish(
    "pulses",
    "vegetarian",
    { red: 0.9, white: 0.8, rose: 0.6, orange: 0.6 },
    [3, 1.4],
    [2.5, 1.6],
    [4, 1.3],
    [0, 0.9],
    ["tuscany", "spain-white", "greece", "languedoc"],
  ),
  dish(
    "veggie-burger",
    "vegetarian",
    { red: 0.8, white: 0.8, rose: 0.7 },
    [3, 1.5],
    [2, 1.6],
    [4, 1.3],
    [0, 1],
    ["beaujolais", "loire", "rhone-south"],
  ),
  // Asian
  dish(
    "sushi",
    "asian",
    { white: 1, sparkling: 0.9, rose: 0.5 },
    [2, 1.2],
    [0, 0.5],
    [4.5, 1.1],
    [0.5, 1.1],
    ["riesling", "austria", "champagne", "spain-white"],
  ),
  dish(
    "thai",
    "asian",
    { white: 1, rose: 0.8, sparkling: 0.6 },
    [2.5, 1.3],
    [0, 0.7],
    [4, 1.3],
    [2, 1.2],
    ["riesling", "alsace", "argentina"],
  ),
  dish(
    "curry",
    "asian",
    { white: 0.9, rose: 0.8, red: 0.6 },
    [3, 1.4],
    [1, 1.3],
    [3.5, 1.4],
    [2, 1.3],
    ["alsace", "riesling", "rhone-south"],
  ),
  dish(
    "chinese",
    "asian",
    { white: 0.9, rose: 0.8, red: 0.7, sparkling: 0.6 },
    [3, 1.4],
    [1.5, 1.4],
    [4, 1.3],
    [1.5, 1.3],
    ["alsace", "beaujolais", "loire"],
  ),
  // Cheese
  dish(
    "hard-cheese",
    "cheese",
    { red: 1, white: 0.6, fortified: 0.8 },
    [4, 1.3],
    [3.5, 1.5],
    [3.5, 1.4],
    [0.5, 1.3],
    ["bordeaux", "rioja", "piedmont", "port"],
  ),
  dish(
    "soft-cheese",
    "cheese",
    { white: 1, sparkling: 0.9, red: 0.4 },
    [3, 1.3],
    [0.5, 1],
    [4.5, 1.1],
    [0.5, 1.2],
    ["champagne", "burgundy", "loire"],
  ),
  dish(
    "blue-cheese",
    "cheese",
    { dessert: 1, fortified: 1, red: 0.4, white: 0.4 },
    [4, 1.4],
    [1, 1.3],
    [3.5, 1.5],
    [4, 1.2],
    ["bordeaux", "port", "tokaji", "southwest"],
  ),
  dish(
    "goat-cheese",
    "cheese",
    { white: 1, rose: 0.6, sparkling: 0.5 },
    [2.5, 1.2],
    [0, 0.6],
    [5, 1],
    [0, 0.9],
    ["loire", "new-zealand"],
  ),
  // Dessert
  dish(
    "chocolate",
    "dessert",
    { fortified: 1, dessert: 0.9, red: 0.5 },
    [4.5, 1.2],
    [2, 1.5],
    [2.5, 1.5],
    [4, 1.2],
    ["port", "sherry", "languedoc"],
  ),
  dish(
    "fruit-tart",
    "dessert",
    { dessert: 1, sparkling: 0.7, white: 0.5 },
    [3, 1.3],
    [0, 0.7],
    [4, 1.3],
    [4, 1.2],
    ["riesling", "loire", "tokaji", "alsace"],
  ),
  dish(
    "custard",
    "dessert",
    { dessert: 1, fortified: 0.8 },
    [4, 1.3],
    [0, 0.8],
    [3.5, 1.4],
    [4.5, 1.1],
    ["bordeaux", "sherry", "southwest"],
  ),
  dish(
    "ice-cream",
    "dessert",
    { sparkling: 1, dessert: 0.9 },
    [2.5, 1.3],
    [0, 0.6],
    [4, 1.3],
    [4, 1.2],
    ["piedmont", "veneto", "italy-south"],
  ),
  // Snacks
  dish(
    "aperitif",
    "snacks",
    { sparkling: 1, white: 0.9, rose: 0.8, fortified: 0.6 },
    [2.5, 1.3],
    [0, 0.7],
    [4.5, 1.1],
    [0, 1],
    ["champagne", "cava", "sherry", "provence"],
  ),
  dish(
    "nuts",
    "snacks",
    { fortified: 1, white: 0.7, sparkling: 0.5 },
    [3.5, 1.4],
    [1, 1.4],
    [3.5, 1.5],
    [1.5, 1.5],
    ["sherry", "jura", "portugal"],
  ),
  dish(
    "fries",
    "snacks",
    { sparkling: 1, white: 0.8, rose: 0.7 },
    [2.5, 1.3],
    [0, 0.8],
    [5, 1],
    [0, 1],
    ["champagne", "cava", "veneto"],
  ),
  // Other
  dish(
    "soup",
    "other",
    { white: 0.9, rose: 0.7, red: 0.6, fortified: 0.5 },
    [2.5, 1.4],
    [1, 1.5],
    [4, 1.3],
    [0, 1],
    ["burgundy", "austria", "sherry"],
  ),
  dish(
    "eggs",
    "other",
    { white: 1, sparkling: 0.8, red: 0.4 },
    [2.5, 1.3],
    [0.5, 1],
    [4, 1.2],
    [0, 0.9],
    ["burgundy", "alsace", "beaujolais"],
  ),
  dish(
    "spicy",
    "other",
    { white: 0.9, rose: 0.9, red: 0.7 },
    [3, 1.4],
    [1, 1.3],
    [4, 1.3],
    [2, 1.3],
    ["alsace", "riesling", "rhone-south", "california"],
  ),
];

export const dishById = (id: string): Dish | undefined => DISHES.find((d) => d.id === id);

/** What a wine is like on the four axes that matter for food (0–5). */
export interface WineProfile {
  body: number;
  tannin: number;
  acidity: number;
  sweetness: number;
}

const BASE: Record<WineType, WineProfile> = {
  red: { body: 3.5, tannin: 3.5, acidity: 3.5, sweetness: 0 },
  white: { body: 2.5, tannin: 0, acidity: 4, sweetness: 0.5 },
  rose: { body: 2, tannin: 0.5, acidity: 4, sweetness: 0.5 },
  sparkling: { body: 2.5, tannin: 0.5, acidity: 4.5, sweetness: 1 },
  dessert: { body: 3.5, tannin: 0.5, acidity: 3.5, sweetness: 4.5 },
  fortified: { body: 4.5, tannin: 1.5, acidity: 3, sweetness: 3 },
  orange: { body: 3, tannin: 2.5, acidity: 4, sweetness: 0 },
};

type Nudge = Partial<WineProfile>;

/** How a region's style moves the colour's baseline. Judgement, not measurement: it says "Estimated". */
const REGION_NUDGE: ReadonlyArray<readonly [WineStyle, Partial<Record<WineType, Nudge>>]> = [
  ["beaujolais", { red: { body: -1.2, tannin: -1.5, acidity: 0.3 } }],
  ["burgundy", { red: { body: -0.6, tannin: -0.8, acidity: 0.4 }, white: { body: 0.5 } }],
  ["bordeaux", { red: { body: 0.5, tannin: 0.8 }, white: { acidity: 0.2 } }],
  ["rhone-north", { red: { body: 0.8, tannin: 0.6 } }],
  ["rhone-south", { red: { body: 0.7, sweetness: 0.2 } }],
  ["piedmont", { red: { body: 0.3, tannin: 1, acidity: 0.8 } }],
  ["tuscany", { red: { tannin: 0.2, acidity: 0.7 } }],
  ["rioja", { red: { body: 0.6, tannin: 0.3 } }],
  ["ribera", { red: { body: 0.7, tannin: 0.5 } }],
  ["priorat", { red: { body: 1, tannin: 0.5 } }],
  ["italy-south", { red: { body: 0.6, tannin: 0.2 } }],
  ["loire", { white: { acidity: 0.7, body: -0.5 }, red: { body: -0.8 } }],
  ["alsace", { white: { body: 0.3, sweetness: 0.4 } }],
  ["riesling", { white: { acidity: 0.8, sweetness: 0.7, body: -0.5 } }],
  ["champagne", { sparkling: { acidity: 0.3, body: 0.4 } }],
  ["cava", { sparkling: { body: -0.3 } }],
  ["new-zealand", { white: { acidity: 0.7 } }],
  ["california", { red: { body: 0.8 } }],
  ["australia", { red: { body: 0.8 } }],
  ["argentina", { red: { body: 0.8 } }],
  ["chile", { red: { body: 0.6 } }],
  ["port", { fortified: { sweetness: 0.5, body: 0.3 } }],
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function wineProfile(wine: {
  type: WineType;
  countryCode: string | null;
  region: string | null;
  name?: string | null;
}): WineProfile {
  const base = BASE[wine.type];
  const style = styleOf({
    countryCode: wine.countryCode,
    region: wine.region,
    name: wine.name ?? null,
  });
  const nudge = REGION_NUDGE.find(([s]) => s === style)?.[1][wine.type] ?? {};
  return {
    body: clamp(base.body + (nudge.body ?? 0), 0, 5),
    tannin: clamp(base.tannin + (nudge.tannin ?? 0), 0, 5),
    acidity: clamp(base.acidity + (nudge.acidity ?? 0), 0, 5),
    sweetness: clamp(base.sweetness + (nudge.sweetness ?? 0), 0, 5),
  };
}

/** Why a wine suits a dish, in codes the screen turns into sentences. */
export const MATCH_REASONS = [
  "colour",
  "classic-region",
  "body",
  "acidity",
  "tannin",
  "sweetness",
] as const;
export type MatchReason = (typeof MATCH_REASONS)[number];

export interface PairingScore {
  /** 0–98: how well the wine suits the dish. Never 100: a pairing is a suggestion. */
  score: number;
  reasons: MatchReason[];
}

/** How close a value is to a target: 1 at the ideal, 0 three tolerances away. */
const closeness = (value: number, [ideal, tolerance]: Target) =>
  Math.max(0, 1 - Math.abs(value - ideal) / tolerance / 3);

export function scorePairing(
  wine: { type: WineType; countryCode: string | null; region: string | null; name?: string | null },
  d: Dish,
): PairingScore {
  const p = wineProfile(wine);
  const style = styleOf({
    countryCode: wine.countryCode,
    region: wine.region,
    name: wine.name ?? null,
  });
  const colour = d.weights[wine.type] ?? 0.15;
  const classic = d.styles.includes(style);
  let score = colour * 42;
  score += closeness(p.body, d.body) * 14;
  score += closeness(p.tannin, d.tannin) * 14;
  score += closeness(p.acidity, d.acidity) * 12;
  score += closeness(p.sweetness, d.sweetness) * 10;
  if (classic) score += 6;

  const reasons: MatchReason[] = [];
  if (colour >= 0.9) reasons.push("colour");
  if (classic) reasons.push("classic-region");
  if (Math.abs(p.body - d.body[0]) < 0.8) reasons.push("body");
  if (p.acidity >= 4 && d.acidity[0] >= 4) reasons.push("acidity");
  if (p.tannin >= 4 && d.tannin[0] >= 4) reasons.push("tannin");
  if (p.sweetness >= 3 && d.sweetness[0] >= 3) reasons.push("sweetness");
  return { score: Math.min(98, Math.round(score)), reasons: reasons.slice(0, 3) };
}

/** Matches a typed phrase to dishes ("steak", "pasta") by their id and group, so a search box can narrow the list. */
export function matchesDish(d: Dish, query: string, label: string): boolean {
  const q = normalizeText(query);
  if (q === "") return true;
  return normalizeText(`${d.id} ${d.group} ${label}`).includes(q);
}
