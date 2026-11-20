import { WINE_TYPES, type WineType } from "../cellar";
import type { FoodMain, FoodProfile, FoodTag } from "../food/types";
import { STYLE_KEYS } from "./styles";
import type { WineReading } from "./wine";

/**
 * DOES THIS WINE SUIT THIS DISH, and why. The answer comes from the structure of both: how heavy the dish eats
 * against the body of the wine, whether there is acidity for the fat and the acid on the plate, whether the dish
 * can carry the wine's tannin, whether the wine is sweet enough for a dessert, what chili does to alcohol and
 * tannin. Every rule adds a note, so the explanation is the calculation, not a story told afterwards.
 *
 * A wine starts as "neutral": nothing is wrong with it, and nothing speaks for it. Reasons for it lift it to
 * "acceptable" (it will do, and here is why) and to "good"; things that go wrong take it down to "poor"; a hard
 * clash makes it poor whatever else is true. Only good and acceptable wines are ever offered; a neutral wine is
 * at most named as the closest there is. The number is only there to put wines in order. It is never shown and
 * it is not a percentage of anything.
 */

export const PAIRING_LEVELS = ["good", "acceptable", "neutral", "poor"] as const;
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
  "fresh-with-seafood",
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
export const GOOD_FROM = 72;
export const ACCEPTABLE_FROM = 68;
/** Below this too much is against a wine to call it neutral. */
export const NEUTRAL_FROM = 55;
/**
 * A pairing a dish is known for has stood the test of the table: where the rules object to it on a soft point
 * (Gewurztraminer's low acidity with Munster), the objection counts for this much of what it otherwise would.
 */
const CLASSIC_DAMPING = 0.5;

/** How much tannin a dish can carry before the wine tastes hard, by what it is built on (0–5). */
const TANNIN_CAPACITY: Record<FoodMain, number> = {
  "red-meat": 5,
  game: 5,
  pork: 3,
  poultry: 3,
  "white-fish": 1,
  "oily-fish": 2.5,
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
export const AFFINITY: Partial<Record<FoodTag, readonly string[]>> = {
  asparagus: ["crisp white", "sauvignon blanc", "gruner veltliner", "pinot blanc"],
  artichoke: ["crisp white", "sauvignon blanc", "gruner veltliner"],
  iodine: ["muscadet", "chablis", "champagne", "crisp white", "dry sherry"],
  "raw-seafood": ["crisp white", "traditional method sparkling", "dry sherry"],
  "goat-cheese": ["sauvignon blanc", "sancerre", "pouilly fume", "chenin blanc"],
  tomato: ["sangiovese", "barbera", "tuscany", "montepulciano", "nero d avola"],
  earthy: ["pinot noir", "nebbiolo", "burgundy", "piedmont"],
  truffle: ["nebbiolo", "pinot noir", "burgundy", "piedmont"],
  "green-herb": ["sauvignon blanc", "gruner veltliner", "vermentino", "crisp white"],
  coconut: ["aromatic white", "off-dry white", "riesling", "gewurztraminer", "pinot gris"],
  cured: ["light red", "dry rose", "dry sherry", "lambrusco", "gamay", "beaujolais"],
  smoked: [
    "riesling",
    "aromatic white",
    "traditional method sparkling",
    "oaked white",
    "pinot gris",
    "alsace",
  ],
  cream: ["rich white", "oaked white", "chardonnay"],
  butter: ["rich white", "oaked white", "chardonnay"],
  chocolate: ["port", "sweet red", "sweet fortified"],
  caramel: ["tawny port", "sweet fortified", "sweet white"],
  nutty: ["tawny port", "dry sherry", "sweet fortified"],
  "fruit-dessert": ["sweet white", "moscato d asti"],
  "blue-cheese": ["sweet white", "port", "sweet fortified"],
  braised: ["full red", "medium red"],
  pickled: ["riesling", "crisp white", "gruner veltliner"],
  soy: ["off-dry white", "riesling", "pinot noir", "dry sherry"],
};

const COLOURS: ReadonlySet<string> = new Set(WINE_TYPES);
/**
 * Colours that are a style in themselves: a dish known for rosé, bubbles or an orange wine names something as
 * narrow as a grape. "Red" and "white" say far less, and stay a hint.
 */
const NARROW_COLOURS: ReadonlySet<string> = new Set(["rose", "sparkling", "orange"]);
const STYLE_WORDS: ReadonlySet<string> = new Set(STYLE_KEYS);

/** The reasons that can carry "good" on their own (see the end of `assessPairing`). */
const VOUCHING: ReadonlySet<PairingPro> = new Set<PairingPro>([
  "classic",
  "affinity",
  "tannin-meets-meat",
  "fresh-with-seafood",
  "sweetness-meets-sweetness",
  "sweet-with-salt",
  "sweetness-tames-heat",
  "bubbles-refresh",
]);

export interface AssessedWine extends Pick<WineReading, "structure" | "keys" | "colourOnly"> {
  type: WineType;
  /** The grapes each region among `keys` is known for (see `WineReading.native`); absent: not known. */
  native?: Readonly<Record<string, readonly string[]>>;
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

  // A classic names a wine ("sancerre", "nebbiolo", "rhone"). A dish that only names a colour ("red") says much
  // less: that is worth a little, and never what a named classic is worth.
  // A place named next to one of its own grapes ("pinot noir, burgundy") means that place's wine of that grape:
  // a white Burgundy does not answer to it.
  const named = food.classics.filter((c) => {
    if (COLOURS.has(c)) return NARROW_COLOURS.has(c);
    const grapesOfPlace = wine.native?.[c];
    if (!grapesOfPlace) return true;
    const asked = grapesOfPlace.filter((g) => food.classics.includes(g));
    return asked.length === 0 || asked.some((g) => wine.keys.includes(g));
  });
  const classic = answers(named);
  // Known for a grape, a place or an appellation, as against known for a kind of wine ("a rosé"): only the
  // first softens what speaks against the wine (a rosé stays too light for a cassoulet).
  const classicByName = answers(named.filter((c) => !NARROW_COLOURS.has(c)));
  // A partnership that names this wine's grape, place or appellation; one that only names its kind ("a crisp
  // white", "a full red") is true of half a cellar and counts for less.
  let specific = false;
  if (classic) pro("classic", 12);
  else {
    const partners = food.tags.flatMap((t) => AFFINITY[t] ?? []);
    specific = answers(partners.filter((k) => !STYLE_WORDS.has(k)));
    if (specific || answers(partners)) pro("affinity", 5);
    else if (answers(food.classics)) pro("affinity", 3);
  }

  // A dish known for a sweet or fortified wine (foie gras with Sauternes, Stilton with port) says so by naming
  // that kind of wine among its classics.
  // (Named as a grape, place or appellation: "a sparkling wine" among the classics of fish and chips does not
  // make a sweet sparkling wine the wine it is known for.)
  const knownForSweet =
    classicByName ||
    ((wine.type === "dessert" || wine.type === "fortified") && food.classics.includes(wine.type));
  const blue = tag("blue-cheese");
  const saltyCheese = !blue && main === "cheese" && f.salt >= 2;
  // A glazed main course (teriyaki, Peking duck) is sweet and still a main course: only a dessert, or something
  // as sweet as one that is not built on meat, fish or vegetables, is judged as a dessert.
  const sweetDish =
    main === "dessert" || (f.sweet >= 2.5 && (main === "pasta-grain" || main === "snack"));

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
    // A delicate dessert is flattened by a fortified wine much louder than itself, however sweet. (A sweet white
    // is intense by nature and still light on its feet: this is about spirit and age.)
    const louder = w.intensity - f.intensity;
    if (
      wine.type === "fortified" &&
      louder > 1.5 &&
      !tag("chocolate") &&
      !tag("caramel") &&
      !tag("nutty")
    )
      con("overpowers", (louder - 1.5) * 10);
    if (w.fizz && f.weight <= 2 && gap < 1) pro("bubbles-refresh", 4);
  } else {
    // --- sweetness in the glass, with a savoury dish ---
    if (w.sweetness >= 3.5) {
      if (blue) pro("sweet-with-salt", 12);
      else if (knownForSweet) pro("sweet-with-salt", 2);
      // A hard, salty cheese takes a mellow fortified wine; other sweet wines are too much for it.
      else if (saltyCheese && wine.type === "fortified" && w.tannin < 3) pro("sweet-with-salt", 3);
      else if (saltyCheese || f.heat >= 2 || f.sweet >= 1.5 || tag("sweet-glaze"))
        con("too-sweet", 14);
      else con("sweet-with-savoury");
    } else if (w.sweetness >= 1.5) {
      if (f.heat >= 1.5) pro("sweetness-tames-heat", 10);
      else if (blue) pro("sweet-with-salt", 6);
      else if (f.sweet >= 1 || tag("sweet-glaze")) pro("sweetness-meets-sweetness", 6);
      else if (f.spice >= 2 || tag("smoked") || tag("pickled") || tag("coconut"))
        pro("aromatics-meet-spice", 3);
      else if (main === "red-meat" || main === "game") con("too-sweet", 18);
      else con("too-sweet", 7);
    }

    // --- weight ---
    // A wine that is too heavy buries the dish; one that is too light tastes thin beside it. Bubbles carry a
    // wine a little further down the scale (towards lighter food), not up it.
    const richMeat = (main === "red-meat" || main === "game") && f.weight >= 4 && f.fat >= 1.5;
    // Chili makes firm tannin taste hard and bitter long before it is a clash: a very tannic wine gets no credit
    // for the meat once there is noticeable heat on the plate.
    const hardWithHeat = f.heat >= 1 && w.tannin >= 4;
    const firmForMeat = richMeat && w.tannin >= 3 && f.heat < 2 && !hardWithHeat;
    let diff = w.body - f.weight;
    if (w.fizz && diff > 0) diff = Math.max(0, diff - 0.5);
    // A light wine cannot bury a dish: with the lightest food a lean white is simply the lightest there is.
    const light = w.body <= 2.5;
    // A fresh wine with no oak and next to no tannin goes further up the scale than its body says: that is what
    // makes a dry rosé, a Gamay or a Grüner Veltliner a wine for the whole table. Not beside rich red meat.
    const versatile =
      w.tannin < 2 && w.oak <= 1 && w.acidity >= 3.5 && w.sweetness < 1.5 && !richMeat;
    const under = versatile ? 1.75 : 1;
    if (diff > (light ? 1.5 : 1)) con("too-heavy", (diff - (light ? 1.5 : 1)) * 14);
    // A firm red beside rich meat is carried by its tannin more than by its body.
    else if (diff < -under) con("too-light", (-diff - under) * (firmForMeat ? 5 : 9));
    else if (Math.abs(diff) <= 0.75 || (light && f.weight <= 2 && diff > 0))
      pro("weight-matches", 5);

    // --- tannin ---
    const redSauce = tag("red-wine-sauce");
    let capacity = TANNIN_CAPACITY[main];
    if (tag("goat-cheese")) capacity = Math.min(capacity, 1);
    if (tag("blue-cheese")) capacity = Math.min(capacity, w.sweetness >= 3 ? 4.5 : 1.5);
    capacity += Math.min(1, f.fat * 0.35);
    if (tag("charred")) capacity += 0.5;
    if (tag("braised")) capacity += 0.5;
    // Savoury richness (cheese and tomato baked together, a ragù) carries more tannin than its base suggests.
    if (f.umami >= 2 && f.fat >= 2) capacity += 0.75;
    if (redSauce) capacity = Math.max(capacity, 4);
    capacity -= f.heat * 0.8;
    if (f.umami >= 2 && f.salt < 2 && f.fat < 2) capacity -= 0.7;
    if (f.acid >= 2) capacity -= 0.5;
    if (tag("egg-yolk") || tag("soy") || tag("vinegar")) capacity -= 0.5;
    if (tag("artichoke") || tag("asparagus")) capacity = Math.min(capacity, 1);
    // Away from raw and delicate seafood, a wine with next to no tannin is never "too firm".
    capacity = Math.max(
      main === "white-fish" || main === "shellfish" || tag("raw-seafood") ? 0.5 : 1.5,
      capacity,
    );

    const seafood = main === "white-fish" || main === "shellfish" || main === "oily-fish";
    if ((tag("raw-seafood") || tag("iodine")) && w.tannin >= 2) con("tannin-with-fish");
    // Meaty, oily fish (salmon, tuna) carries a light red; delicate white fish and shellfish do not.
    else if (seafood && !redSauce && w.tannin >= (main === "oily-fish" ? 3.5 : 3))
      con("tannin-with-fish");
    else if (f.heat >= 2 && w.tannin >= 3.5) con("tannin-with-heat");
    else if (w.tannin > capacity) con("tannin-too-firm", (w.tannin - capacity) * 13);
    else if (hardWithHeat) con("tannin-too-firm", (w.tannin - 3) * f.heat * 6);

    // Savoury richness carries tannin whatever it is built on: a ragù, a burger, a board of hard cheese.
    const carriesTannin =
      !richMeat &&
      f.umami >= 2 &&
      f.fat >= 2 &&
      f.weight >= 3 &&
      main !== "white-fish" &&
      main !== "shellfish" &&
      main !== "oily-fish" &&
      main !== "egg";
    if (richMeat && f.heat < 2) {
      // With heat on the plate the credit is half: the meat still carries the wine, the chili works against it.
      if (w.tannin >= 3 && !hardWithHeat) pro("tannin-meets-meat", f.heat >= 1 ? 4 : 8);
      else if (w.tannin < 1.5) con("underpowered", 10);
    } else if (
      carriesTannin &&
      wine.type === "red" &&
      f.heat < 1 &&
      w.tannin >= 2.5 &&
      w.tannin <= capacity
    )
      pro("tannin-meets-meat", 6);

    // --- acidity ---
    // Where the dish carries a firm red, its tannin does the cutting; everywhere else fat, salt and acid on the
    // plate ask for freshness in the glass.
    const tanninDoesIt = w.tannin >= 3 && w.tannin <= capacity && f.fat >= 1.5;
    let need = 0;
    if (f.acid >= 1) need = Math.max(need, 2.5 + f.acid * 0.75);
    if (!tanninDoesIt) {
      if (f.fat >= 2) need = Math.max(need, 3 + (f.fat - 2) * 0.5);
      if (f.salt >= 2) need = Math.max(need, 3.5);
    }
    if (tag("tomato")) need = Math.max(need, 3.5);
    if (tag("fried") || tag("citrus") || tag("raw-seafood") || tag("iodine") || tag("pickled"))
      need = Math.max(need, 4);
    if (tag("vinegar")) need = Math.max(need, 4.3);
    if (need > 0) {
      // Bubbles scrub the palate as acidity does.
      const short = need - (w.acidity + (w.fizz ? 0.5 : 0));
      if (short > 0.25) con("needs-more-acidity", short * 9);
      // Credit only where the dish really asks for it and the wine is really fresh.
      else if (
        w.acidity >= (f.fat >= 2 || tag("fried") ? 3.7 : 4) &&
        ((f.fat >= 2 && !tanninDoesIt) || f.acid >= 2 || tag("fried") || tag("tomato"))
      )
        pro(f.fat >= 2 || tag("fried") ? "acidity-cuts-richness" : "acidity-meets-acidity", 6);
    }

    // --- fish and shellfish ---
    // The oldest rule there is: a fresh, unoaked white (or bubbles) with fish from the sea.
    if (
      (main === "white-fish" || main === "shellfish") &&
      !redSauce &&
      (wine.type === "white" || wine.type === "sparkling") &&
      w.acidity >= 4 &&
      w.oak <= 1 &&
      w.sweetness < 1.5
    )
      pro("fresh-with-seafood", 6);

    // --- bubbles ---
    if (w.fizz) {
      // Fried food, raw seafood, egg yolk and salty snacks with bubbles is a rule in itself; salt on a light
      // dish is a reason for them and no more.
      if (tag("fried") || tag("raw-seafood") || tag("egg-yolk") || main === "snack")
        pro("bubbles-refresh", 7);
      else if (f.salt >= 2 && f.weight <= 3) pro("bubbles-refresh", 5);
    }

    // --- chili heat and spice ---
    // Heat and a sweet glaze make a bone-dry wine taste thin and sharp: it will do, it is not the wine for it.
    if ((f.heat >= 1.5 || f.sweet >= 1.5 || tag("sweet-glaze")) && w.sweetness < 1 && w.tannin < 2)
      con("not-sweet-enough", 6);
    if (f.heat >= 1.5) {
      if (w.alcohol >= 3 && f.heat >= 2) con("alcohol-fans-heat", (f.heat - 0.5) * 7);
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
  const soft = classicByName ? CLASSIC_DAMPING : 1;
  const raw =
    NEUTRAL +
    pros.reduce((sum, [, p]) => sum + p, 0) -
    cons.reduce((sum, [note, p]) => sum + (HARD.has(note) ? 0 : p * soft), 0);
  let score = Math.max(0, Math.min(100, Math.round(raw)));
  if (clash) score = Math.min(score, NEUTRAL_FROM - 15);
  // A wine known by its colour alone may do; it cannot be vouched for.
  if (wine.colourOnly) score = Math.min(score, GOOD_FROM - 1);

  // "It will do" has to rest on something: a wine with nothing against it but nothing for it either (or only
  // that it is about as heavy as the dish) is not a recommendation.
  const substantive = pros.some(([note]) => note !== "weight-matches");
  // "Good" is a recommendation with confidence, and that has to rest on the dish pointing at this wine: a named
  // classic, a long-standing partnership, or one of the few structural matches that are a rule in themselves.
  // A wine that is only about as heavy, fresh enough or sparkling scores well and still only "will do".
  const vouched = pros.some(
    ([note, points]) =>
      VOUCHING.has(note) &&
      // An affinity that only names the wine's kind, and tannin beside savoury richness that is not rich meat,
      // are reasons, not recommendations.
      (note !== "affinity" || (specific && points >= 5)) &&
      (note !== "tannin-meets-meat" || points >= 8) &&
      (note !== "bubbles-refresh" || points >= 7),
  );
  return {
    level:
      score >= GOOD_FROM && vouched
        ? "good"
        : score >= ACCEPTABLE_FROM && substantive
          ? "acceptable"
          : score >= NEUTRAL_FROM && !clash
            ? "neutral"
            : "poor",
    score,
    pros: [...new Set(pros.map(([note]) => note))],
    cons: [...new Set(cons.map(([note]) => note))],
    clash,
  };
}
