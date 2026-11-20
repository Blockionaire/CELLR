import type { FoodProfile } from "./types";

/**
 * WHEN A DISH NEEDS A SECOND READER. The parser says how sure it is of its own reading; a model is asked to read
 * the dish only when the parser shows it may have misread it. Designed and measured on the readable benchmark
 * sets (`scripts/sommelier-eval/self-knowledge.ts`), never on the blind one.
 *
 * The parser's list of unread words also holds the words around the dish ("tonight", "under 25 euro", "my
 * in-laws are coming"). Those say nothing about the food, so they do not count as a sign of a misread dish.
 */
export type DishRouteReason = "no-main" | "unread-food-words" | "not-sure";

export interface DishRoute {
  read: boolean;
  reason: DishRouteReason | null;
  /** The unread words that may be food: what the model is asked about. */
  unread: string[];
}

/**
 * Words about the occasion, the people, the budget, the shop, the cellar and the asking itself, in English and
 * Dutch. Generic: no dish, ingredient or preparation is in this list, so a dish word is never ignored.
 */
const FRAMING = new Set(
  // asking, serving, buying
  (
    "serve serving pour open opening openmaken schenk schenken drink drinking drinken pull pick choose kies kiezen " +
    "bring brengen buy buying kopen koop bestellen order ordering haal halen give geef get got recommend suggest " +
    "advise advies aanraden pair pairing match matches fits fit works work goes gaat past passen suits " +
    // occasion and time
    "tonight vanavond today vandaag tomorrow morgen sunday monday tuesday wednesday thursday friday saturday " +
    "zondag maandag dinsdag woensdag donderdag vrijdag zaterdag weekend week night nacht evening avond " +
    "afternoon middag morning ochtend dinner diner lunch brunch supper starter voorgerecht vooraf main hoofdgerecht " +
    "course gang borrel party feest birthday verjaardag anniversary new year eve christmas kerst easter pasen " +
    "occasion gelegenheid celebration movie later late early quick snel " +
    // people
    "guests gasten guest gast friends vrienden friend vriend kids kinderen children partner wife husband vrouw man " +
    "mother father mom dad moeder vader ouders parents laws schoonouders family familie neighbours buren coming " +
    "komt komen eten eat eating eats having hebben heb have has staat staan him her them hem haar hen they wij " +
    "allebei both together samen grown ups everyone iedereen people mensen " +
    // budget and shop
    "euro euros eur under onder max maximaal hooguit budget price prijs cheap goedkoop expensive duur splurged " +
    "online shop winkel store nearby buurt collect ophalen delivery bezorgen " +
    // cellar and wine words that are not food
    "cellar kelder rack rek bottle bottles fles flessen wijntje wine wines wijn wijnen glass glas reds whites " +
    "rood wit rode witte red white bubbels bubbles style stijl classic klassiek " +
    // filler
    "only alleen actually eigenlijk prima fine hmm else another about always altijd now nu doing there daar daarbij " +
    "here hier table tafel out degrees graden weather weer outside buiten own eigen one two three " +
    "four five six eight ten dozen een twee drie vier vijf zes acht tien preferably liever weet vond vinden alweer " +
    "think denk sure zeker please graag maybe misschien really echt pretty behoorlijk thing something iets"
  ).split(" "),
);

export function routeDishReading(food: FoodProfile): DishRoute {
  const unread = food.unknown.filter((w) => !FRAMING.has(w) && !/^\d/.test(w));
  // Nothing was recognised and nothing is left to read: not a question about a dish at all.
  if (food.main === null)
    return unread.length > 0
      ? { read: true, reason: "no-main", unread }
      : { read: false, reason: null, unread };
  if (unread.length > 0) return { read: true, reason: "unread-food-words", unread };
  // Anything the parser itself is not sure of: a guess from little, a plate composed from parts, or a known dish
  // with something said beside it that the parser could not place. Only a reading it calls sure is trusted.
  if (food.confidence !== "high") return { read: true, reason: "not-sure", unread };
  return { read: false, reason: null, unread };
}

/** Asking words that carry nothing of a dish; joining words ("with", "met", "and") are kept: they say what goes with what. */
const ASKING = new Set(
  (
    "what which wat welke how hoe do does did should could would can kan kun kunnen ik i we me my mijn our onze " +
    "ons you je jij u is are was zijn ben the a an de het een for voor to naar of van that dat die this deze dit " +
    "any some wel even ever is't isn't it's its it er there's whats what's"
  ).split(" "),
);

/** The longest dish phrase a model is asked about, in words and characters. */
export const DISH_PHRASE_MAX_WORDS = 12;
const DISH_PHRASE_MAX_CHARS = 120;

/**
 * THE DISH, AND NOTHING ELSE. What a model is asked to read, and what a shared reading is stored under: the
 * question lower case, without names of people (@mentions), numbers, prices, punctuation, and without the words
 * around the dish (the occasion, the people, the budget, the asking). "Zuurkool met casselerrib vanavond, welke
 * wijn? Max 20 euro" becomes "zuurkool met casselerrib". Null when nothing is left. The model sees exactly this
 * phrase, so a reading is a function of the phrase alone and may be shared between people who type it.
 */
export function dishPhrase(text: string): string | null {
  const words = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, "")
    .replace(/[@＠][\p{L}\p{N}._-]*/gu, " ")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\s'-]/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w.length > 0 && !FRAMING.has(w) && !ASKING.has(w));
  // A joining word at either end joins nothing: "with roast chicken" is "roast chicken".
  const JOIN = new Set([
    "with",
    "met",
    "and",
    "en",
    "bij",
    "along",
    "alongside",
    "or",
    "of",
    "plus",
  ]);
  while (words.length > 0 && JOIN.has(words[0]!)) words.shift();
  while (words.length > 0 && JOIN.has(words.at(-1)!)) words.pop();
  const phrase = words
    .slice(0, DISH_PHRASE_MAX_WORDS)
    .join(" ")
    .slice(0, DISH_PHRASE_MAX_CHARS)
    .trim();
  return phrase.length >= 3 ? phrase : null;
}
