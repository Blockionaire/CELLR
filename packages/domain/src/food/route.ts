import type { FoodKnowledge } from "./compose";
import { parseFood } from "./parse";
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

/** Asking words that carry nothing of a dish. */
const ASKING = new Set(
  (
    "what which wat welke how hoe do does did should could would can kan kun kunnen ik i we me my mijn our onze " +
    "ons you je jij u is are was zijn ben the a an de het een for voor to naar that dat die this deze dit " +
    "any some wel even ever is't isn't it's its it er there's whats what's tell vertel about over know weet " +
    "please graag want wil willen like need nodig also ook just gewoon still nog then dan so dus but maar not niet no geen " +
    "cheaper goedkoper goedkopers instead anders else different lighter lichter lichters heavier zwaarder keep bewaren " +
    "ready klaar find vind zoek gift cadeau cadeautje present boss baas colleague collega neighbour"
  ).split(" "),
);

/** Words that join parts of a dish: kept inside a phrase, dropped at its ends. */
const JOIN = new Set(
  "with met and en bij along alongside or of plus in op uit van on from a la al au aux".split(" "),
);

/**
 * Words about a person rather than a dish: health, grief, identity numbers, secrets. Never sent, whatever else
 * is in the phrase. A list cannot be complete; the phrase is also bounded to the words next to the food.
 */
const PERSONAL = new Set(
  (
    "diabetic diabetes diabetisch suikerziekte suikerpatient pregnant pregnancy zwanger zwangerschap cancer kanker " +
    "chemo tumour tumor allergic allergy allergie allergisch intolerant intolerance intolerantie coeliac celiac " +
    "coeliakie sick ill ziek illness ziekte hospital ziekenhuis died dead death overleden dood rouw funeral " +
    "begrafenis depressed depression depressie sad verdrietig medication medicine medicijnen medicatie pills pillen " +
    "alcoholic alcoholist addiction verslaving therapy therapie divorce scheiding ex wife husband vrouw man " +
    "password wachtwoord iban bsn pin pincode account rekening address adres phone telefoon email mail call bel"
  ).split(" "),
);

const NUMBER_WORD =
  /^(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|nul|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf|dertien|veertien|vijftien|zestien|zeventien|achttien|negentien|twintig|dertig|veertig|vijftig|zestig|zeventig|tachtig|negentig|honderd|duizend|miljoen)$|^(?:een|twee|drie|vier|vijf|zes|zeven|acht|negen)en(?:twintig|dertig|veertig|vijftig|zestig|zeventig|tachtig|negentig)$|^(?:twee|drie|vier|vijf|zes|zeven|acht|negen)?(?:honderd|duizend)\p{L}*$/u;
const isNumberWord = (w: string) => w.split("-").every((part) => NUMBER_WORD.test(part));

/** Little words that can stand between a cue and a dish, or open a question before it. */
const LEAD = new Set(
  (
    "the a an de het een some wat our my mijn onze ons we we're were i i'm im we've it's its there's " +
    "having have hebben eten eet eat eating tonight vanavond today vandaag"
  ).split(" "),
);

/** The longest dish phrase a model is asked about, in words and characters. */
export const DISH_PHRASE_MAX_WORDS = 12;
const DISH_PHRASE_MAX_CHARS = 120;
/** How far from the recognised food an unread word may stand and still be part of the dish. */
const NEAR = 2;

/** Whether the question is about which wine to pour at all ("what wine?", "welke fles?", "wat schenk ik"). */
export const asksForWine = (text: string): boolean =>
  /\b(?:wine|wines|wijn|wijnen|wijntje|bottle|bottles|fles|flessen|pour|schenk|schenken|serve|serveer|open|openen|openmaken|drink|drinken|pair|pairing|goes|past|bubbels)\b/i.test(
    text.normalize("NFKC"),
  );

const fold = (w: string) => w.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * THE DISH, AND NOTHING ELSE. What a model is asked to read, and what a shared reading is stored under.
 *
 * Built from the words the parser recognises as food, and the unread words right next to them (at most two
 * on either side: "zuurkool met *casselerrib*"), never from the rest of the question. With no food recognised at
 * all, only the words at the very start of the question or right after "with", "met", "bij", "eat", "eten"
 * ("we eten *casselerrib*"). In every case dropped: anything with an "@" in it (a mention, an e-mail), web
 * addresses, numbers and number words, names (a word written with a capital inside a sentence that is not a food
 * word), words about health, grief or identity, and the words about the occasion, the people, the budget and the
 * asking. Lower case, accents folded, at most 12 words. Null when nothing is left.
 *
 * The model sees exactly this phrase, so a reading is a function of the phrase alone and may be shared between
 * people who type it.
 */
export function dishPhrase(text: string, k: FoodKnowledge): string | null {
  const cleaned = text
    .normalize("NFKC")
    .replace(/[\u200b-\u200f\u2060-\u206f\ufeff\u00ad]/g, "")
    // Every token that holds an "@" anywhere, whole, and the word after "@ ": a mention, "anna@", an e-mail.
    .replace(/\S*[@＠﹫]\s*\S*/gu, " ")
    .replace(/\b(?:https?:\/\/|www\.)\S*/giu, " ")
    .replace(/\S+\.(?:com|nl|org|net|be|de|eu|io|uk|fr|info|app|dev)\b\S*/giu, " ")
    .replace(/\S*\d\S*/gu, " ");
  type Tok = { word: string; capital: boolean; start: boolean };
  const toks: Tok[] = [];
  let sentenceStart = true;
  for (const m of cleaned.matchAll(/[\p{L}'’-]+|[.!?;:]/gu)) {
    const raw = m[0];
    if (/^[.!?;:]$/.test(raw)) {
      sentenceStart = true;
      continue;
    }
    const word = fold(raw)
      .replace(/^['’-]+|['’-]+$/g, "")
      .replace(/’/g, "'");
    if (word.length === 0) continue;
    toks.push({ word, capital: /^\p{Lu}/u.test(raw), start: sentenceStart });
    sentenceStart = false;
  }
  const isFood = (w: string) => {
    if (JOIN.has(w) || FRAMING.has(w) || ASKING.has(w)) return false;
    const p = parseFood(w, k);
    return (
      p.main !== null ||
      p.dishId !== null ||
      p.parts.ingredients.length + p.parts.sauces.length + p.parts.techniques.length > 0
    );
  };
  const food = toks.map((t) => isFood(t.word));
  const allowed = (t: Tok, i: number) =>
    food[i] ||
    (!FRAMING.has(t.word) &&
      !ASKING.has(t.word) &&
      !PERSONAL.has(t.word) &&
      !isNumberWord(t.word) &&
      // A capital inside a sentence on a word that is not food: most often a name.
      !(t.capital && !t.start) &&
      t.word.length > 1);
  const first = food.indexOf(true);
  const last = food.lastIndexOf(true);
  let picked: string[] = [];
  if (first >= 0) {
    for (let i = Math.max(0, first - NEAR); i <= Math.min(toks.length - 1, last + NEAR); i += 1) {
      const t = toks[i]!;
      // Inside the span every allowed word counts; outside it, only an unbroken run of allowed words next to it.
      if (JOIN.has(t.word) || allowed(t, i)) picked.push(t.word);
      else if (i < first) picked = [];
      else if (i > last) break;
    }
  } else {
    // No food recognised: the words that open the question, or the ones after a word that introduces a dish.
    const CUE = new Set([
      "with",
      "met",
      "bij",
      "eat",
      "eating",
      "eten",
      "eet",
      "serving",
      "cooking",
      "kook",
      "maak",
    ]);
    const cue = toks.findIndex((t) => CUE.has(t.word));
    let from = cue >= 0 ? cue + 1 : 0;
    // Past the little words before the dish ("with the bobotie", "bij de bobotie", "we're having bobotie").
    while (from < toks.length && LEAD.has(toks[from]!.word)) from += 1;
    for (let i = from; i < toks.length && picked.length < 4; i += 1) {
      const t = toks[i]!;
      if (!allowed(t, i) && !JOIN.has(t.word)) break;
      picked.push(t.word);
    }
  }
  while (picked.length > 0 && JOIN.has(picked[0]!)) picked.shift();
  while (picked.length > 0 && JOIN.has(picked.at(-1)!)) picked.pop();
  const phrase = picked
    .slice(0, DISH_PHRASE_MAX_WORDS)
    .join(" ")
    .slice(0, DISH_PHRASE_MAX_CHARS)
    .trim();
  return phrase.length >= 3 ? phrase : null;
}
