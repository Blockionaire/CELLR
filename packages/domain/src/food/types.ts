/**
 * FOOD INTELLIGENCE: what a dish is, in the terms that decide which wine suits it. A dish is not a category
 * ("fish") but a structure: what it is built on, how heavy it eats, how much fat, acid, sweetness, salt, bitterness,
 * umami and heat it carries, how it was cooked and what sauce is on it. Pan-seared sea bass with lemon butter is a
 * delicate white fish, made richer by butter and brighter by lemon; the wine follows from that, not from "fish".
 *
 * Everything here is deterministic and has no I/O. The knowledge (ingredients, techniques, sauces, dishes) is typed
 * data in this folder; where it came from and who has checked it is on every entry (see `Provenance`).
 */

/** What a dish is built on. Decides how much tannin it can take and which clashes are possible. */
export const FOOD_MAINS = [
  "red-meat",
  "game",
  "pork",
  "poultry",
  "white-fish",
  "oily-fish",
  "shellfish",
  "vegetable",
  "mushroom",
  "pasta-grain",
  "egg",
  "cheese",
  "dessert",
  "snack",
  "pulse",
] as const;
export type FoodMain = (typeof FOOD_MAINS)[number];

/**
 * The structure of a dish. `weight` and `intensity` run from 1 (delicate) to 5 (very rich, very strong); the rest
 * from 0 (none) to 3 (dominant). The numbers are judgements on a coarse scale, not measurements.
 */
export interface FoodStructure {
  weight: number;
  intensity: number;
  fat: number;
  acid: number;
  sweet: number;
  salt: number;
  bitter: number;
  umami: number;
  /** Chili heat. */
  heat: number;
  /** Aromatic spice and herbs (cumin, ginger, five-spice), apart from heat. */
  spice: number;
  smoke: number;
}
export const FOOD_AXES = [
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
] as const satisfies ReadonlyArray<keyof FoodStructure>;
export type FoodAxis = (typeof FOOD_AXES)[number];

/** Things about a dish that a structure cannot say, each of which changes what a wine does with it. */
export const FOOD_TAGS = [
  /** Raw or barely cured fish and shellfish: tannin tastes metallic, oak tastes heavy. */
  "raw-seafood",
  /** Briny, iodine (oysters, sea urchin, seaweed). */
  "iodine",
  /** Fish oils (mackerel, herring, sardine, salmon, eel): tannin turns metallic. */
  "fish-oil",
  /** Vinegar or a sharp dressing: makes a soft wine taste flat. */
  "vinegar",
  /** Artichoke (cynarin) and asparagus: make wine taste sweet or tinny; they want crisp, unoaked whites. */
  "artichoke",
  "asparagus",
  /** Runny egg yolk coats the mouth and dulls a wine. */
  "egg-yolk",
  /** Tomato: acid and umami together; wants a wine with acidity. */
  "tomato",
  /** Cream or butter sauce. */
  "cream",
  "butter",
  /** Citrus on the plate. */
  "citrus",
  /** Soy, miso, fish sauce: umami and salt that harden tannin. */
  "soy",
  /** Smoked or cured. */
  "smoked",
  "cured",
  /** Deep-fried or battered: wants acidity or bubbles. */
  "fried",
  /** Char from a grill or barbecue: takes fruit and some tannin. */
  "charred",
  /** Long braise in wine or stock. */
  "braised",
  /** A red-wine sauce or braise: the dish leans to red whatever the main ingredient is. */
  "red-wine-sauce",
  /** Blue or washed-rind cheese: salt and funk that want sweetness. */
  "blue-cheese",
  "goat-cheese",
  /** Chocolate and cocoa. */
  "chocolate",
  /** Fruit-led sweetness (tarts, berries) as opposed to caramel, cream or chocolate. */
  "fruit-dessert",
  "caramel",
  /** Earthy: mushrooms, truffle, beetroot, lentils. */
  "earthy",
  "truffle",
  /** Fresh green herbs, pesto, green vegetables. */
  "green-herb",
  /** Coconut milk. */
  "coconut",
  /** Peanut or sesame sauce. */
  "nutty",
  /** Sweet-and-savoury glaze (hoisin, teriyaki, barbecue sauce, fruit sauce on meat). */
  "sweet-glaze",
  /** Pickled or fermented (sauerkraut, kimchi, pickles). */
  "pickled",
  /** Mustard, horseradish, wasabi. */
  "pungent",
  /** Garlic-led. */
  "garlic",
] as const;
export type FoodTag = (typeof FOOD_TAGS)[number];

/** Where an entry came from and whether a person with wine or culinary expertise has checked it. */
export interface Provenance {
  /** "cellr": written for CELLR from general culinary knowledge; no recipe text or third-party dataset copied. */
  source: "cellr";
  /** False until a human expert has reviewed the entry. Switches that use the data stay off until then. */
  reviewed: boolean;
}
export const DRAFT: Provenance = Object.freeze({ source: "cellr", reviewed: false });

interface Named {
  /** A stable id (kebab-case, English). */
  id: string;
  /** Names and synonyms as people write them, lower case; the first is the display name. */
  en: readonly string[];
  nl: readonly string[];
}

export interface Ingredient extends Named {
  /** The class it gives a dish when it is what the dish is built on. Absent for accents (lemon, capers, herbs). */
  main?: FoodMain;
  /** What it brings. Missing axes are 0, except weight and intensity, which default to 2. */
  s: Partial<FoodStructure>;
  tags?: readonly FoodTag[];
  /**
   * Wines this ingredient is known for, however it is cooked (duck and Pinot Noir, oysters and Muscadet), as keys
   * the pairing engine understands. Used when a dish is composed around it; a dish template names its own.
   */
  classics?: readonly string[];
  /**
   * It seasons a dish more often than it is one (bacon bits, pancetta): named after "with", it does not take the
   * plate over from the starch it is on. "Pancakes with bacon" are pancakes; "rice with chicken" is chicken.
   */
  garnish?: true;
}

export interface Technique extends Named {
  /** What cooking it this way adds to (or takes from) the main ingredient. */
  delta: Partial<FoodStructure>;
  tags?: readonly FoodTag[];
  /**
   * True for a word that says how the dish tastes rather than how it was cooked ("spicy", "mild", "creamy"). It
   * applies on top of any dish, also one that has its own technique.
   */
  modifier?: boolean;
}

export interface Sauce extends Named {
  s: Partial<FoodStructure>;
  tags?: readonly FoodTag[];
  /** How much the sauce, rather than what is under it, decides the wine: 1 a little, 2 as much, 3 more. */
  dominance: 1 | 2 | 3;
  /**
   * What it is usually served on, for when someone names only the sauce ("we're having a korma", "carbonara").
   * The reading is then an assumption and is never more than "medium" sure.
   */
  usual?: FoodMain;
}

/** A dish people name as one thing ("coq au vin", "stamppot boerenkool"), described by its parts. */
export interface DishTemplate extends Named {
  main: string;
  technique?: string;
  sauce?: string;
  /** Other ingredients that matter for the wine. */
  with?: readonly string[];
  /** Where the dish as a whole differs from the sum of its parts. */
  adjust?: Partial<FoodStructure>;
  /** The class of the dish when it is not the main ingredient's (a quiche is not "egg" at table: it is pastry). */
  mainAs?: FoodMain;
  tags?: readonly FoodTag[];
  /**
   * Wines that are classic with it, as loose keys the pairing engine understands (a region style such as "loire",
   * a grape such as "sauvignon blanc", or a type such as "sparkling"). A bonus, never a requirement.
   */
  classics?: readonly string[];
}

/** How the engine came to its reading. */
export type FoodSource = "dish" | "composed" | "none";

export interface FoodProfile {
  source: FoodSource;
  /** The template that matched, when one did. */
  dishId: string | null;
  /** A short name for the dish, in English and Dutch, built from what was recognised. */
  label: { en: string; nl: string };
  /**
   * The dish in the words it was said in (lower case, without accents), from the first thing recognised to the
   * last: "zeebaars met citroenboter". Null for a profile that was not read from text.
   */
  said: string | null;
  main: FoodMain | null;
  structure: FoodStructure;
  tags: FoodTag[];
  classics: string[];
  /** What was recognised, by id. */
  parts: { ingredients: string[]; techniques: string[]; sauces: string[] };
  /** Content words the engine did not understand (after dropping everyday words). */
  unknown: string[];
  /**
   * How far the reading can be trusted: "high" for a known dish or a main ingredient with its preparation and
   * nothing left unread; "medium" when something was unread or only a main ingredient was found; "low" when the
   * dish was guessed from little.
   */
  confidence: "high" | "medium" | "low";
  /**
   * Who read the dish: absent or "parser" for the food engine alone; "model" when a model described a dish the
   * parser could not place (food/reading.ts). Such a reading is never "high".
   */
  readBy?: "parser" | "model";
}

/** The axes that stand out in a profile, strongest first: what an explanation should mention. */
export function dominantAxes(s: FoodStructure): FoodAxis[] {
  return (["heat", "sweet", "acid", "fat", "umami", "smoke", "salt", "bitter", "spice"] as const)
    .filter((axis) => s[axis] >= 2)
    .sort((a, b) => s[b] - s[a]);
}
