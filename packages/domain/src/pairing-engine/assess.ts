import type { WineType } from "../cellar";
import type { FoodMain, FoodProfile, FoodTag } from "../food/types";
import type { WineReading } from "./wine";

/**
 * DOES THIS WINE SUIT THIS DISH, and why. The answer comes from the structure of both: how heavy the dish eats
 * against the body of the wine, whether there is acidity for the fat and the acid on the plate, whether the dish
 * can carry the wine's tannin, whether the wine is sweet enough for a dessert, what chili does to alcohol and
 * tannin. Every rule adds a note, so the explanation is the calculation, not a story told afterwards.
 *
 * A wine starts as "acceptable": nothing is wrong with it. Things that go right lift it to "good"; things that
 * go wrong take it down to "poor"; a hard clash makes it poor whatever else is true. The number is only there to
 * put wines in order. It is never shown and it is not a percentage of anything.
 */

export const PAIRING_LEVELS = ["good", "acceptable", "poor"] as const;
export type PairingLevel = (typeof PAIRING_LEVELS)[number];

/** Why a wine suits a dish. The screens turn the codes into sentences. */
export const PAIRING_PROS = [
  "classic",
  "affinity",
  "weight-matches",
  "acidity-cuts-richness",
  "acidity-meets-acidity",
  "bubbles-refresh",
  "tannin-meets-meat",
  "sweetness-tames-heat",
  "sweetness-meets-sweetness",
  "sweet-with-salt",
  "aromatics-meet-spice",
  "oak-meets-richness",
  "fruit-meets-char",
  "red-for-red-wine-sauce",
] as const;
export type PairingPro = (typeof PAIRING_PROS)[number];

/** What holds a wine back with a dish. The last five are hard clashes: one of them makes the pairing poor. */
export const PAIRING_CONS = [
  "too-heavy",
  "too-light",
  "tannin-too-firm",
  "needs-more-acidity",
  "not-sweet-enough",
  "too-sweet",
  "alcohol-fans-heat",
  "oak-overwhelms",
  "overpowers",
  "underpowered",
  "red-with-delicate-fish",
  "white-for-red-wine-sauce",
  "little-known",
  "tannin-with-fish",
  "tannin-with-heat",
  "tannin-with-sweet",
  "dry-with-dessert",
  "sweet-with-savoury",
] as const;
export type PairingCon = (typeof PAIRING_CONS)[number];

const HARD: ReadonlySet<PairingCon> = new Set<PairingCon>([
  "tannin-with-fish",
  "tannin-with-heat",
  "tannin-with-sweet",
  "dry-with-dessert",
  "sweet-with-savoury",
]);

export interface Assessment {
  level: PairingLevel;
  /** For putting wines in order inside the engine. Not for display. */
  score: number;
  /** Why it suits, strongest first. */
  pros: PairingPro[];
  /** What holds it back, strongest first. */
  cons: PairingCon[];
  /** The hard clash, when there is one. */
  clash: PairingCon | null;
}

/** Where "acceptable" starts and where "good" starts. A wine with nothing for or against it scores `NEUTRAL`. */
export const NEUTRAL = 60;
export const GOOD_FROM = 70;
export const ACCEPTABLE_FROM = 50;

/** How much tannin a dish can carry before the wine tastes hard, by what it is built on (0–5). */
const TANNIN_CAPACITY: Record<FoodMain, number> = {
  "red-meat": 5,
  game: 5,
  pork: 3,
  poultry: 2.5,
  "white-fish": 1,
  "oily-fish": 1.5,
  shellfish: 0.8,
  vegetable: 2,
  mushroom: 3,
  "pasta-grain": 3,
  egg: 1.5,
  cheese: 3,
  dessert: 1,
  snack: 2,
  pulse: 3,
};

/** Tags that have long-standing partners: a wine that answers to one of the keys gets credit for it. */
const AFFINITY: Partial<Record<FoodTag, readonly string[]>> = {
  iodine: ["muscadet", "chablis", "champagne", "crisp white", "dry sherry"],
  "raw-seafood": ["crisp white", "traditional method sparkling", "dry sherry"],
  "goat-cheese": ["sauvignon blanc", "sancerre", "pouilly fume", "chenin blanc"],
  tomato: ["sangiovese", "barbera", "tuscany", "montepulciano", "nero d avola"],
  earthy: ["pinot noir", "nebbiolo", "burgundy", "piedmont"],
  truffle: ["nebbiolo", "pinot noir", "burgundy", "piedmont"],
  "green-herb": ["sauvignon blanc", "gruner veltliner", "vermentino", "crisp white"],
  coconut: ["aromatic white", "off-dry white", "riesling", "gewurztraminer", "pinot gris"],
  cured: ["light red", "dry rose", "dry sherry", "lambrusco"],
  smoked: ["riesling", "aromatic white", "traditional method sparkling", "oaked white"],
  cream: ["rich white", "oaked white", "chardonnay"],
  butter: ["rich white", "oaked white", "chardonnay"],
  chocolate: ["port", "sweet red", "sweet fortified"],
  caramel: ["tawny port", "sweet fortified", "sweet white"],
  nutty: ["tawny port", "dry sherry", "sweet fortified"],
  "fruit-dessert": ["sweet white", "moscato"],
  "blue-cheese": ["sweet white", "port", "sweet fortified"],
  braised: ["full red", "medium red"],
  pickled: ["riesling", "crisp white", "gruner veltliner"],
  soy: ["off-dry white", "riesling", "pinot noir", "dry sherry"],
};

export interface AssessedWine extends Pick<WineReading, "structure" | "keys" | "colourOnly"> {
  type: WineType;
}

/**
 * Assesses one wine with one dish. The dish must have been understood (`food.main` is set); a caller with a dish
 * it could not read has nothing to assess and says so instead.
 */
export function assessPairing(food: FoodProfile, wine: AssessedWine): Assessment {
  const f = food.structure;
  const w = wine.structure;
  const main: FoodMain = food.main ?? "vegetable";
  const tag = (t: FoodTag) => food.tags.includes(t);
  const answers = (keys: readonly string[]) => keys.some((k) => wine.keys.includes(k));

  const pros: Array<readonly [PairingPro, number]> = [];
  const cons: Array<readonly [PairingCon, number]> = [];
  const pro = (note: PairingPro, points: number) => void pros.push([note, points]);
  const con = (note: PairingCon, points = 100) => void cons.push([note, points]);

  const classic = answers(food.classics);
  if (classic) pro("classic", 10);
  else {
    const affinity = food.tags.some((t) => answers(AFFINITY[t] ?? []));
    if (affinity) pro("affinity", 6);
  }

  const salty = tag("blue-cheese") || (main === "cheese" && f.salt >= 2);
  const sweetDish = main === "dessert" || f.sweet >= 2;

  if (sweetDish) {
    // A dessert makes a wine that is less sweet than itself taste thin and sour.
    const need = f.sweet >= 3 ? 4 : f.sweet >= 2 ? 3 : 2;
    const gap = need - w.sweetness;
    if (gap >= 2) con("dry-with-dessert");
    else if (gap >= 1) con("not-sweet-enough", 16);
    else if (gap >= 0.5) con("not-sweet-enough", 7);
    else pro("sweetness-meets-sweetness", 10);

    if (w.tannin >= 3) {
      if (w.sweetness < 3) con("tannin-with-sweet");
      else if (!tag("chocolate") && !tag("nutty") && !tag("caramel")) con("tannin-too-firm", 12);
    }
    const diff = w.body - f.weight;
    // Sweet wines are full by nature: only a real mismatch counts.
    if (diff > 2) con("too-heavy", (diff - 2) * 10);
    if (diff < -2) con("too-light", (-diff - 2) * 10);
    if (tag("chocolate") || f.bitter >= 2) {
      if (w.intensity < 4 || w.body < 3.5) con("underpowered", 14);
    }
    if (tag("fruit-dessert") && w.acidity >= 3.5 && w.sweetness >= 3)
      pro("acidity-meets-acidity", 5);
    if (w.fizz && f.weight <= 2 && gap < 1) pro("bubbles-refresh", 4);
  } else {
    // --- sweetness in the glass, with a savoury dish ---
    if (w.sweetness >= 3.5) {
      if (salty) pro("sweet-with-salt", 12);
      else if (classic) pro("sweet-with-salt", 2);
      else if (f.heat >= 2 || f.sweet >= 1 || tag("sweet-glaze")) con("too-sweet", 12);
      else con("sweet-with-savoury");
    } else if (w.sweetness >= 1.5) {
      if (f.heat >= 1.5) pro("sweetness-tames-heat", 10);
      else if (salty) pro("sweet-with-salt", 6);
      else if (f.sweet >= 1 || tag("sweet-glaze")) pro("sweetness-meets-sweetness", 6);
      else if (f.spice >= 2 || tag("smoked") || tag("pickled") || tag("coconut"))
        pro("aromatics-meet-spice", 3);
      else if (main === "red-meat" || main === "game") con("too-sweet", 18);
      else con("too-sweet", 7);
    }

    // --- weight ---
    let diff = w.body - f.weight;
    if (w.fizz) diff = diff > 0 ? Math.max(0, diff - 0.5) : Math.min(0, diff + 0.5);
    // A wine that is too heavy buries the dish; one that is too light only tastes thin, so it gets more room.
    if (diff > 1) con("too-heavy", (diff - 1) * 14);
    else if (diff < -1.5) con("too-light", (-diff - 1.5) * 10);
    else if (Math.abs(diff) <= 0.75) pro("weight-matches", 5);

    // --- tannin ---
    const redSauce = tag("red-wine-sauce");
    let capacity = TANNIN_CAPACITY[main];
    if (tag("goat-cheese")) capacity = Math.min(capacity, 1);
    if (tag("blue-cheese")) capacity = Math.min(capacity, w.sweetness >= 3 ? 4.5 : 1.5);
    capacity += Math.min(1, f.fat * 0.35);
    if (tag("charred")) capacity += 0.5;
    if (tag("braised")) capacity += 0.5;
    if (redSauce) capacity = Math.max(capacity, 4);
    capacity -= f.heat * 0.8;
    if (f.umami >= 2 && f.salt < 2 && f.fat < 2) capacity -= 0.7;
    if (f.acid >= 2) capacity -= 0.5;
    if (tag("egg-yolk") || tag("soy") || tag("vinegar")) capacity -= 0.5;
    if (tag("artichoke") || tag("asparagus")) capacity = Math.min(capacity, 1);
    capacity = Math.max(0.5, capacity);

    const seafood = main === "white-fish" || main === "shellfish" || main === "oily-fish";
    if ((tag("raw-seafood") || tag("iodine")) && w.tannin >= 2) con("tannin-with-fish");
    else if (seafood && !redSauce && w.tannin >= (tag("fish-oil") ? 3 : 3.5))
      con("tannin-with-fish");
    else if (f.heat >= 2 && w.tannin >= 3.5) con("tannin-with-heat");
    else if (w.tannin > capacity) con("tannin-too-firm", (w.tannin - capacity) * 13);

    const wantsTannin = (main === "red-meat" || main === "game") && f.weight >= 4 && f.fat >= 1.5;
    if (wantsTannin && f.heat < 2) {
      if (w.tannin >= 3) pro("tannin-meets-meat", 8);
      else if (w.tannin < 1.5) con("underpowered", 10);
    }

    // --- acidity ---
    const tanninDoesIt = wantsTannin && w.tannin >= 3;
    let need = 0;
    if (f.acid >= 1) need = Math.max(need, 2.5 + f.acid * 0.75);
    if (f.fat >= 2 && !tanninDoesIt) need = Math.max(need, 3 + (f.fat - 2) * 0.5);
    if (f.salt >= 2) need = Math.max(need, 3.5);
    if (tag("tomato")) need = Math.max(need, 3.8);
    if (tag("fried") || tag("citrus") || tag("raw-seafood") || tag("iodine"))
      need = Math.max(need, 4);
    if (tag("vinegar") || tag("pickled")) need = Math.max(need, 4.3);
    if (need > 0) {
      const short = need - w.acidity;
      if (short > 0.25) con("needs-more-acidity", short * 11);
      else if (need >= 3.5)
        pro(f.fat >= 2 || tag("fried") ? "acidity-cuts-richness" : "acidity-meets-acidity", 6);
    }

    // --- bubbles ---
    if (
      w.fizz &&
      (tag("fried") || f.salt >= 2 || main === "snack" || tag("raw-seafood") || tag("egg-yolk"))
    )
      pro("bubbles-refresh", 7);

    // --- chili heat and spice ---
    if (f.heat >= 1.5) {
      if (w.alcohol >= 3) con("alcohol-fans-heat", (f.heat - 0.5) * 7);
      if (w.oak >= 2) con("oak-overwhelms", 5);
    }
    if (f.spice >= 2 && w.intensity >= 3.5 && w.tannin < 3) pro("aromatics-meet-spice", 5);

    // --- intensity ---
    const louder = w.intensity - f.intensity;
    if (louder > 1.5) con("overpowers", (louder - 1.5) * 8);
    if (louder < -1.5) con("underpowered", (-louder - 1.5) * 8);

    // --- oak ---
    if (w.oak >= 2) {
      const fragile =
        tag("raw-seafood") ||
        tag("iodine") ||
        tag("asparagus") ||
        tag("artichoke") ||
        (f.weight <= 2 && f.acid >= 2);
      if (fragile) con("oak-overwhelms", 10);
      else if (
        w.tannin < 2 &&
        f.weight >= 3 &&
        (tag("cream") || tag("butter") || tag("smoked") || f.fat >= 2)
      )
        pro("oak-meets-richness", 5);
      else if (w.tannin >= 2 && (tag("charred") || f.smoke >= 1)) pro("fruit-meets-char", 4);
    }
    if ((tag("artichoke") || tag("asparagus")) && w.oak >= 1.5 && w.oak < 2)
      con("oak-overwhelms", 8);

    // --- colour, where structure alone does not say it ---
    if (redSauce) {
      if (wine.type === "red") pro("red-for-red-wine-sauce", 4);
      else if (w.body < 4) con("white-for-red-wine-sauce", 10);
    } else if (
      wine.type === "red" &&
      (main === "white-fish" || main === "shellfish") &&
      !tag("tomato") &&
      !tag("charred") &&
      !tag("earthy")
    )
      con("red-with-delicate-fish", 8);
  }

  if (wine.colourOnly) con("little-known", 0);

  pros.sort((a, b) => b[1] - a[1]);
  cons.sort((a, b) => b[1] - a[1]);
  const clash = cons.find(([note]) => HARD.has(note))?.[0] ?? null;
  const raw =
    NEUTRAL +
    pros.reduce((sum, [, p]) => sum + p, 0) -
    cons.reduce((sum, [note, p]) => sum + (HARD.has(note) ? 0 : p), 0);
  let score = Math.max(0, Math.min(100, Math.round(raw)));
  if (clash) score = Math.min(score, ACCEPTABLE_FROM - 15);
  // A wine known by its colour alone may do; it cannot be vouched for.
  if (wine.colourOnly) score = Math.min(score, GOOD_FROM - 1);

  return {
    level: score >= GOOD_FROM ? "good" : score >= ACCEPTABLE_FROM ? "acceptable" : "poor",
    score,
    pros: [...new Set(pros.map(([note]) => note))],
    cons: [...new Set(cons.map(([note]) => note))],
    clash,
  };
}
