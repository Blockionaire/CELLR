import { normalizeText } from "../cellar";
import { composeStructure, templateParts, type DishParts, type FoodKnowledge } from "./compose";
import type { DishTemplate, FoodMain, FoodProfile, Ingredient, Sauce, Technique } from "./types";

/**
 * READING A DISH. The text a person typed ("pan-seared sea bass with lemon butter sauce", "gebakken zeebaars met
 * citroenbotersaus") is matched against the knowledge: first whole dishes, then sauces, techniques and
 * ingredients, longest phrase first, in English and Dutch at once. Dutch compounds are split on known words
 * ("citroenbotersaus" = citroen + botersaus). What is found is composed into one structure; what is not understood
 * is kept as `unknown` and lowers the confidence. No model is involved.
 */

type Entry =
  | { kind: "dish"; item: DishTemplate }
  | { kind: "sauce"; item: Sauce }
  | { kind: "technique"; item: Technique }
  | { kind: "ingredient"; item: Ingredient };

interface Lexicon {
  /** Normalised phrase → what it names. */
  phrases: Map<string, Entry[]>;
  /** Single words that may be a piece of a compound. */
  words: Set<string>;
  longest: number;
}

const ORDER = { dish: 0, sauce: 1, technique: 2, ingredient: 3 } as const;
const lexicons = new WeakMap<FoodKnowledge, Lexicon>();

function lexiconOf(k: FoodKnowledge): Lexicon {
  const cached = lexicons.get(k);
  if (cached) return cached;
  const phrases = new Map<string, Entry[]>();
  const words = new Set<string>();
  let longest = 1;
  const add = (entry: Entry) => {
    for (const name of [...entry.item.en, ...entry.item.nl]) {
      const phrase = normalizeText(name);
      if (phrase === "") continue;
      const list = phrases.get(phrase) ?? [];
      if (!list.some((e) => e.kind === entry.kind && e.item.id === entry.item.id)) list.push(entry);
      list.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
      phrases.set(phrase, list);
      const n = phrase.split(" ").length;
      longest = Math.max(longest, n);
      if (n === 1 && entry.kind !== "dish") words.add(phrase);
    }
  };
  for (const item of k.dishes) add({ kind: "dish", item });
  for (const item of k.sauces) add({ kind: "sauce", item });
  for (const item of k.techniques) add({ kind: "technique", item });
  for (const item of k.ingredients) add({ kind: "ingredient", item });
  const lexicon = { phrases, words, longest };
  lexicons.set(k, lexicon);
  return lexicon;
}

/** Words that say nothing about the dish: the question around it, in English and Dutch. */
const STOP = new Set(
  `before after starter starters main course courses aperitif aperitief delivery order ordering thing even
  red white rose rood rode wit witte dessertwijn oma opa grandma homemade zelfgemaakt bestellen besteld aankan
  new year eve christmas kerst oud nieuw verjaardag birthday
  a an the and or of in on at to for from by with without as is are was be been it its this that these those i me
  my we us our you your he she they them what which who how when where why do does did can could should would will
  shall may might must have has had having not no yes just also very really some any all both more most much many
  few little bit lot lots good best better great nice perfect right ideal well wine wines bottle bottles glass drink
  drinks drinking open opening pour serve serving pair pairs pairing pairings match matches go goes going suit suits
  recommend suggest suggestion choose pick tonight today tomorrow evening dinner lunch supper meal dish food eat
  eating having making cooking cook cooked make made prepare prepared plan planning want wants need like love
  thinking think please thanks thank hi hello hey cellar buy buying something anything nothing kind sort type
  de het een en of van in op aan te voor uit door met zonder als is zijn was wordt worden dit dat deze die ik mij
  mijn me we wij ons onze je jij jouw u uw hij zij ze hun wat welke wie hoe wanneer waar waarom doe doet deed kan
  kunnen zou zouden zal zullen mag moet moeten heb hebt heeft hebben had niet geen ja ook erg heel echt wat enkele
  alle beide meer meest veel weinig beetje goed goede beste beter lekker lekkere mooi mooie perfect ideaal wijn
  wijnen fles flessen glas drinken drink open openen schenken past passen passend bij erbij combineren combinatie
  aanraden aanrader advies kiezen vanavond vandaag morgen avond avondeten diner lunch maaltijd gerecht eten eet
  eten we krijgen maak maken gemaakt koken kook bereid bereiden wil willen graag denk dacht alsjeblieft dank
  bedankt hoi hallo kelder kopen iets niets soort er even eens nog dan maar toch zo over uit thuis gasten
  guests friends vrienden family familie party feest we're i'm im were having`.split(/\s+/),
);

/** Words after which the next thing named is NOT on the plate. */
const NEGATION = new Set([
  "without",
  "zonder",
  "no",
  "geen",
  "not",
  "niet",
  "minus",
  "never",
  "nooit",
]);
/**
 * A negation reaches the next thing named, across at most this many other words ("no red meat", "zonder de
 * saus"), and never past a comma or a full stop. "Not sure what to cook, maybe steak" still means steak.
 */
const NEGATION_REACH = 2;
/** Marks where a clause ended, so that nothing is read across it. Not a word any phrase contains. */
const BREAK = "|";
/** The parser reads this much of a text, measured after it was normalised. */
const MAX_TEXT = 600;
/** Longer "words" than this are not food words, and are not taken apart. */
const MAX_COMPOUND = 40;

/** Endings a word may carry beyond its dictionary form (Dutch and English plurals and inflections). */
const ENDINGS = ["", "s", "es", "en", "e", "n", "jes", "je", "tjes", "tje", "etjes", "etje", "'s"];

function lookupWord(word: string, lex: Lexicon): string | null {
  for (const ending of ENDINGS) {
    if (ending !== "" && !word.endsWith(ending)) continue;
    const stem = ending === "" ? word : word.slice(0, -ending.length);
    if (stem.length < 3) continue;
    if (lex.phrases.has(stem)) return stem;
    // Dutch doubles a consonant or drops a vowel in the plural (mossel/mosselen is regular; tomaat/tomaten is not).
    if (ending === "en" || ending === "e") {
      const last = stem.at(-1)!;
      if (stem.length > 3 && stem.at(-2) === last && lex.phrases.has(stem.slice(0, -1)))
        return stem.slice(0, -1);
      const doubled = stem.replace(/([aeou])([^aeiou])$/, "$1$1$2");
      if (doubled !== stem && lex.phrases.has(doubled)) return doubled;
    }
  }
  // People say what they are doing ("we're grilling", "we grillen", "I'll roast"), the knowledge says what was
  // done ("grilled", "gegrild", "roasted").
  for (const form of verbForms(word)) if (lex.phrases.has(form)) return form;
  return null;
}

function verbForms(word: string): string[] {
  const forms: string[] = [];
  const undouble = (stem: string) =>
    stem.length > 3 && stem.at(-1) === stem.at(-2) ? stem.slice(0, -1) : stem;
  if (word.length >= 6 && word.endsWith("ing")) {
    const stem = word.slice(0, -3);
    forms.push(`${stem}ed`, `${undouble(stem)}ed`, `${stem}d`);
  } else if (word.length >= 4 && !word.endsWith("ed")) {
    forms.push(`${word}ed`, `${word}d`);
  }
  if (word.length >= 5 && word.endsWith("en")) {
    const stem = undouble(word.slice(0, -2));
    forms.push(`ge${word}`, `ge${stem}d`, `ge${stem}t`);
  }
  return forms.filter((f) => f.length >= 5);
}

/** Pieces a Dutch compound may contain that are not food words themselves. */
const GLUE = new Set([
  "saus",
  "sausje",
  "filet",
  "filets",
  "schotel",
  "gerecht",
  "stukjes",
  "blokjes",
  "reepjes",
  "plakjes",
  "s",
]);

/** Splits a compound into known words (fewest pieces), or null when it cannot be split completely. */
function decompound(word: string, lex: Lexicon): string[] | null {
  if (word.length < 7 || word.length > MAX_COMPOUND) return null;
  const best: Array<string[] | null> = Array.from({ length: word.length + 1 }, () => null);
  best[0] = [];
  for (let end = 3; end <= word.length; end++) {
    for (let start = 0; start <= end - 1; start++) {
      const before = best[start];
      if (!before) continue;
      const piece = word.slice(start, end);
      const known =
        piece.length >= 3 &&
        (lex.words.has(piece)
          ? piece
          : GLUE.has(piece)
            ? piece
            : lookupWord(piece, lex) && lex.words.has(lookupWord(piece, lex)!)
              ? lookupWord(piece, lex)!
              : null);
      const link = piece === "s" && start > 0 ? "s" : null;
      const value = known || link;
      if (!value) continue;
      const candidate = [...before, value];
      if (!best[end] || candidate.length < best[end]!.length) best[end] = candidate;
    }
  }
  const pieces = best[word.length];
  if (!pieces || pieces.length < 2) return null;
  const food = pieces.filter((p) => !GLUE.has(p));
  return food.length === 0 ? null : pieces.filter((p) => p !== "s");
}

interface Found {
  entry: Entry;
  /** Position of the first token, to keep the order things were said in. */
  at: number;
  /** How many tokens it covers. */
  length: number;
  negated: boolean;
  /** Directly followed by "with": what comes before is what the dish is, what comes after goes with it. */
  headed: boolean;
}

/** Which main ingredient a plate is "about" when several could be: flesh before cheese and eggs before vegetables. */
const MAIN_RANK: Record<FoodMain, number> = {
  "red-meat": 5,
  game: 5,
  pork: 5,
  poultry: 5,
  "white-fish": 5,
  "oily-fish": 5,
  shellfish: 5,
  dessert: 4,
  cheese: 3,
  egg: 3,
  mushroom: 3,
  pulse: 3,
  "pasta-grain": 2,
  vegetable: 1,
  snack: 1,
};

const STARCH_OR_SNACK: ReadonlySet<FoodMain> = new Set<FoodMain>(["pasta-grain", "snack"]);

function scan(
  text: string,
  lex: Lexicon,
): { found: Found[]; unknown: string[]; said: string | null } {
  // Clause by clause, so that punctuation survives normalising as a break: "n't" is "not".
  const clauses = text
    .slice(0, MAX_TEXT * 4)
    .replace(/n['’]t\b/gi, " not")
    .split(/[,.;:!?()\n]+/)
    .map((clause) => normalizeText(clause))
    .filter(Boolean);
  const raw = clauses.join(` ${BREAK} `).slice(0, MAX_TEXT).split(" ").filter(Boolean);
  // Compounds first: "citroenbotersaus" becomes "citroen botersaus" when both are known.
  const tokens: string[] = [];
  for (const word of raw) {
    if (word === BREAK || lex.phrases.has(word) || STOP.has(word) || lookupWord(word, lex))
      tokens.push(word);
    else tokens.push(...(decompound(word, lex) ?? [word]));
  }
  const found: Found[] = [];
  const unknown: string[] = [];
  // How many more words a negation still reaches; 0 when none is open.
  let negate = 0;
  for (let i = 0; i < tokens.length;) {
    let matched: { entries: Entry[]; length: number } | null = null;
    for (let n = Math.min(lex.longest, tokens.length - i); n >= 1 && !matched; n--) {
      const phrase = tokens.slice(i, i + n).join(" ");
      const exact = lex.phrases.get(phrase);
      if (exact) matched = { entries: exact, length: n };
      else if (n >= 2) {
        // The last word of a phrase may be inflected ("lemon butter sauces", "gegrilde lamskoteletten").
        const head = tokens.slice(i, i + n - 1).join(" ");
        const tail = lookupWord(tokens[i + n - 1]!, lex);
        const inflected = tail ? lex.phrases.get(`${head} ${tail}`) : undefined;
        if (inflected) matched = { entries: inflected, length: n };
      } else {
        const stem = lookupWord(tokens[i]!, lex);
        if (stem) matched = { entries: lex.phrases.get(stem)!, length: 1 };
      }
    }
    const token = tokens[i]!;
    if (matched) {
      const next = tokens[i + matched.length];
      found.push({
        entry: matched.entries[0]!,
        at: i,
        length: matched.length,
        negated: negate > 0,
        headed: next === "with" || next === "met",
      });
      negate = 0;
      i += matched.length;
    } else {
      if (token === BREAK) negate = 0;
      else if (NEGATION.has(token)) negate = NEGATION_REACH + 1;
      else {
        negate = Math.max(0, negate - 1);
        if (!STOP.has(token) && !GLUE.has(token) && token.length > 2 && !/^\d+$/.test(token))
          unknown.push(token);
      }
      i += 1;
    }
  }
  const kept = found.filter((f) => !f.negated);
  // The dish in the person's own words: from the first thing recognised to the last.
  const said =
    kept.length === 0
      ? null
      : tokens
          .slice(kept[0]!.at, kept.at(-1)!.at + kept.at(-1)!.length)
          .filter((t) => t !== BREAK)
          .join(" ");
  return { found: kept, unknown, said };
}

const EMPTY: FoodProfile = {
  source: "none",
  dishId: null,
  said: null,
  label: { en: "", nl: "" },
  main: null,
  structure: composeStructure({ main: null }).structure,
  tags: [],
  classics: [],
  parts: { ingredients: [], techniques: [], sauces: [] },
  unknown: [],
  confidence: "low",
};

const uniq = <T extends { id: string }>(list: T[]) =>
  list.filter((x, i) => list.findIndex((y) => y.id === x.id) === i);

/** What a text says is on the plate. `source: "none"` when no food was recognised in it. */
export function parseFood(text: string, k: FoodKnowledge): FoodProfile {
  const lex = lexiconOf(k);
  const { found, unknown, said } = scan(text, lex);
  const of = <K extends Entry["kind"]>(kind: K) =>
    found
      .filter((f) => f.entry.kind === kind)
      .map((f) => f.entry.item as Extract<Entry, { kind: K }>["item"]);
  const dishes = of("dish");
  const sauces = uniq(of("sauce")).sort((a, b) => b.dominance - a.dominance);
  const allTechniques = uniq(of("technique"));
  const techniques = allTechniques.filter((t) => !t.modifier);
  const modifiers = allTechniques.filter((t) => t.modifier);
  const ingredients = uniq(of("ingredient"));
  if (dishes.length + sauces.length + techniques.length + ingredients.length === 0)
    return { ...EMPTY, unknown };
  const saidAs = said === null ? null : said.slice(0, 120);

  const dish = dishes[0] ?? null;
  let parts: DishParts;
  let main: FoodMain | null;
  let assumed = false;
  if (dish) {
    const own = templateParts(dish, k);
    const named = new Set([dish.main, ...(dish.with ?? [])]);
    parts = {
      ...own,
      extras: [...(own.extras ?? []), ...ingredients.filter((i) => !named.has(i.id))],
      // What the person adds to a known dish ("steak with béarnaise") is said on top of what the dish has.
      moreSauces: sauces.filter((s) => s.id !== dish.sauce),
      moreTechniques: [...(own.technique ? [] : techniques.slice(0, 1)), ...modifiers],
    };
    main = dish.mainAs ?? own.main?.main ?? null;
  } else {
    const mains = ingredients
      .filter((i) => i.main !== undefined)
      .map((i, order) => ({ i, order }))
      .sort((a, b) => MAIN_RANK[b.i.main!] - MAIN_RANK[a.i.main!] || a.order - b.order);
    // "Asparagus with ham and egg" is an asparagus dish: what is named before "with" is what the plate is about,
    // unless that is only the starch under it ("rice with chicken", "fries with stew").
    const head = found.find(
      (f) => f.entry.kind === "ingredient" && f.entry.item.main !== undefined,
    );
    const headed =
      head?.headed &&
      head.entry.kind === "ingredient" &&
      !STARCH_OR_SNACK.has(head.entry.item.main!)
        ? head.entry.item
        : null;
    const chosen = headed ?? mains[0]?.i ?? null;
    parts = {
      main: chosen,
      technique: techniques[0] ?? null,
      sauce: sauces[0] ?? null,
      extras: ingredients.filter((i) => i.id !== chosen?.id),
      moreSauces: sauces.slice(1),
      moreTechniques: modifiers,
    };
    // Only a sauce was named ("a korma", "carbonara"): what it is usually served on is assumed.
    main = chosen?.main ?? sauces[0]?.usual ?? null;
    assumed = chosen === null && main !== null;
  }
  const { structure, tags } = composeStructure(parts);
  const recognisedParts =
    (parts.technique ? 1 : 0) +
    (parts.sauce ? 1 : 0) +
    (parts.extras?.length ?? 0) +
    (parts.moreSauces?.length ?? 0);
  const confidence: FoodProfile["confidence"] = dish
    ? unknown.length <= 1
      ? "high"
      : "medium"
    : main === null
      ? "low"
      : assumed
        ? unknown.length <= 2
          ? "medium"
          : "low"
        : recognisedParts >= 1 && unknown.length === 0
          ? "high"
          : unknown.length <= 2
            ? "medium"
            : "low";
  const name = (lang: "en" | "nl") => {
    if (dish) return (lang === "nl" ? dish.nl[0] : dish.en[0]) ?? dish.en[0]!;
    const word = (x: { en: readonly string[]; nl: readonly string[] } | null | undefined) =>
      x ? ((lang === "nl" ? x.nl[0] : x.en[0]) ?? x.en[0] ?? "") : "";
    const withWord = lang === "nl" ? "met" : "with";
    const head = [word(parts.technique), word(parts.main)].filter(Boolean).join(" ");
    const rest = [word(parts.sauce), ...(parts.extras ?? []).slice(0, 2).map(word)].filter(Boolean);
    return [
      head || rest.shift() || "",
      rest.length ? `${withWord} ${rest.join(lang === "nl" ? " en " : " and ")}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  };
  return {
    source: dish ? "dish" : "composed",
    dishId: dish?.id ?? null,
    label: { en: name("en"), nl: name("nl") },
    said: saidAs,
    main,
    structure,
    tags,
    // A dish names its own classics; a plate composed around an ingredient has that ingredient's.
    classics: [...(dish ? (dish.classics ?? []) : (parts.main?.classics ?? []))],
    parts: {
      ingredients: uniq([...(parts.main ? [parts.main] : []), ...(parts.extras ?? [])]).map(
        (i) => i.id,
      ),
      techniques: uniq([
        ...(parts.technique ? [parts.technique] : []),
        ...(parts.moreTechniques ?? []),
      ]).map((t) => t.id),
      sauces: uniq([...(parts.sauce ? [parts.sauce] : []), ...(parts.moreSauces ?? [])]).map(
        (s) => s.id,
      ),
    },
    unknown,
    confidence,
  };
}

// ---- A menu ---------------------------------------------------------------------------------------------------

/**
 * Words that say "the next course", in English and Dutch, and a course named as a label ("Starter: …",
 * "Hoofdgerecht: …"). Punctuation alone does not make a menu ("I had oysters; tonight lamb"). Words that are
 * ordinary elsewhere only count where they open a clause: "toe" in "voeg kaas toe" is a verb, "dan" in "beter
 * dan" is "than", "first" in "I first want" is not a course.
 */
const COURSE_MARKER = new RegExp(
  [
    String.raw`\b(?:then|followed by|after that|afterwards|to start|to begin|as a starter|for starters|for the starter|as an appeti[sz]er|for dessert|as dessert|for pudding|for the main|as a main|as the main|and for|to finish|and finally|daarna|vervolgens|gevolgd door|vooraf|en dan|als voorgerecht|als amuse|als tussengerecht|als hoofdgerecht|als hoofdgang|als nagerecht|als toetje|als dessert|als afsluiter|als afsluiting|tot slot|als toe)\b`,
    String.raw`(?<=(?:^|[,.;:]|\ben)\s*)toe\b`,
    String.raw`(?<=(?:^|[,.;:])\s*)(?:first|eerst|dan)\b`,
    String.raw`\b(?:starters?|appeti[sz]ers?|amuse(?:[- ]bouche)?|first course|second course|third course|fourth course|main course|mains?|desserts?|pudding|cheese course|cheeses|voorgerecht(?:en)?|tussengerecht|hoofdgerecht|hoofdgang|nagerecht|toetje|kaasplank)\s*:`,
    String.raw`,(?=\s*(?:then|and then|daarna|en dan))`,
  ].join("|"),
  "gi",
);
/** "Which wine with each course?", "a three-course menu", "driegangenmenu": the person says it is a menu. */
const SAYS_MENU =
  /\b(?:each|every) course\b|\bper course\b|\bcourses\b|\b(?:two|three|four|five|six|[2-6])[- ]course\b|\b(?:per|elke|iedere) gang\b|\bgangen\b|\b(?:twee|drie|vier|vijf|zes)gangen\p{L}*|\bmenu\b/iu;
/** A list the person laid out line by line ("- oysters", "2. roast lamb"): at least two such lines. */
const LISTED =
  /(?:^|\n)[ \t]*(?:[-•*]|\d{1,2}[.)])[ \t]*\S[^\n]*\n[ \t]*(?:[-•*]|\d{1,2}[.)])[ \t]*\S/;
/** A piece about another day is not a course of this meal ("we had oysters yesterday, then …"). */
const ANOTHER_DAY =
  /\b(?:yesterday|last night|last week|last year|gisteren|gisteravond|eergisteren|vorige week|vorig jaar)\b/i;
export const MAX_COURSES = 8;

export interface MenuCourse {
  /**
   * The course in the person's own words, as typed (case and accents kept): from the first thing recognised to
   * the last ("Oysters", "chocolate fondant"), or the whole piece for a course that could not be read.
   */
  said: string;
  /** What the food engine made of it; null when it names nothing the engine knows. */
  food: FoodProfile | null;
}
export interface ParsedMenu {
  courses: MenuCourse[];
  /** More courses were said than are planned (`MAX_COURSES`). */
  cut: boolean;
}

/** The longest a course is kept, in characters (the screen shows it shorter still). */
const MAX_COURSE_SAID = 120;

/**
 * A menu, when the text says it is one: courses set apart by words ("to start", "then", "for dessert", "als
 * toetje", "Hoofdgerecht:"), or a plain list (commas and "and", or one course per line) when the person says it
 * is a menu or lays it out as a list. Null when the text is not a menu, or names fewer than two courses the engine
 * can read. A piece that names no main ingredient ("then I add a cream sauce") belongs to the course before it, and
 * so does a side said with "and" in a plain list ("lamb and potatoes"); a short piece that names nothing the engine
 * knows ("the zarzuela") stays a course, unread, so that it is said and not silently dropped.
 */
export function parseMenu(text: string, k: FoodKnowledge): ParsedMenu | null {
  const bounded = text.slice(0, MAX_TEXT * 4);
  COURSE_MARKER.lastIndex = 0;
  const marked = COURSE_MARKER.test(bounded);
  COURSE_MARKER.lastIndex = 0;
  if (!marked && !SAYS_MENU.test(bounded) && !LISTED.test(bounded)) return null;
  // Courses set apart by words, or a plain list: sentences and lines, then commas, then "and".
  const pieces = marked
    ? splitKeeping(bounded, new RegExp(`${COURSE_MARKER.source}|[;\\n?!:]|${FULL_STOP}`, "giu"))
    : splitKeeping(bounded, new RegExp(String.raw`[?!;:\n,&+]|\b(?:and|en)\b|${FULL_STOP}`, "giu"));
  const said = pieces
    .map((p) => ({
      ...p,
      text: p.text.replace(/^[\s,.;:!?•*-]+|[\s,.;:!?•*-]+$/g, "").replace(/^\d{1,2}[.)]\s*/, ""),
    }))
    .filter((p) => p.text.length > 2 && !ANOTHER_DAY.test(p.text));
  const courses: MenuCourse[] = [];
  for (const piece of said) {
    // One course past the cap is enough to know the menu was cut.
    if (courses.length > MAX_COURSES) break;
    const food = parseFood(piece.text, k);
    const previous = courses.at(-1);
    if (food.source === "none") {
      // Words about the menu, not a course ("which wine with each course"): only a piece that names a thing,
      // and that stands where a course stands, counts.
      if (isBareCourse(piece.text) && standsAsCourse(piece, marked))
        courses.push({ said: tidyPiece(piece.text), food: null });
      continue;
    }
    const byAnd = !marked && piece.before === "and";
    if (previous?.food && (food.main === null || (byAnd && isSideOf(food, previous.food)))) {
      // A sauce or a side on its own is part of the course before it.
      const joined = parseFood(`${previous.said}, ${piece.text}`, k);
      courses[courses.length - 1] = {
        // "Lamb and potatoes" is said as one course; a sauce added in a sentence of its own is not repeated.
        said: byAnd
          ? tidyPiece(`${previous.said} ${piece.joiner} ${saidOf(piece.text, food)}`)
          : previous.said,
        food: joined.main ? joined : previous.food,
      };
      continue;
    }
    courses.push({ said: saidOf(piece.text, food), food });
  }
  const read = courses.filter((c) => c.food !== null).length;
  if (read < 2) return null;
  return { courses: courses.slice(0, MAX_COURSES), cut: courses.length > MAX_COURSES };
}

/** What stands between two pieces of a menu: a course word, a label ("Main:"), or punctuation. */
type Break = "start" | "end" | "marker" | "label" | "colon" | "sentence" | "line" | "comma" | "and";
interface Piece {
  text: string;
  before: Break;
  /** The words of the break before it, as typed ("and", "en", "&"). */
  joiner: string;
  after: Break;
}
/** A full stop ends a sentence, but not an abbreviation ("Coquilles St. Jacques"). */
const FULL_STOP = String.raw`(?<!\b\p{L}{1,2})\.`;

const breakOf = (delimiter: string): Break => {
  if (delimiter === ":") return "colon";
  if (/^[.?!]$/.test(delimiter)) return "sentence";
  if (delimiter === ";" || delimiter === "\n") return "line";
  if (delimiter === ",") return "comma";
  if (/^(?:and|en|&|\+)$/i.test(delimiter)) return "and";
  return delimiter.endsWith(":") ? "label" : "marker";
};

/** The text cut at every match, each piece with what stood before and after it. */
function splitKeeping(text: string, delimiters: RegExp): Piece[] {
  const pieces: Piece[] = [];
  let from = 0;
  let before: Break = "start";
  let joiner = "";
  for (const m of text.matchAll(delimiters)) {
    const kind = breakOf(m[0]);
    pieces.push({ text: text.slice(from, m.index), before, joiner, after: kind });
    before = kind;
    joiner = m[0];
    from = m.index + m[0].length;
  }
  pieces.push({ text: text.slice(from), before, joiner, after: "end" });
  return pieces;
}

/**
 * An unread piece is a course only where a course stands: after a course word or a label ("then qwertzu",
 * "Main: zarzuela"), before a course word ("qwertzu to start"), or between the commas of a list. Never a title
 * ("Kerstdiner:", "Our menu:") and never a sentence on its own ("Ignore previous instructions.").
 */
function standsAsCourse(piece: Piece, marked: boolean): boolean {
  if (piece.after === "colon" || piece.after === "label") return false;
  if (marked)
    return piece.before === "marker" || piece.before === "label" || piece.after === "marker";
  return !(
    (piece.before === "start" || piece.before === "sentence") &&
    (piece.after === "end" || piece.after === "sentence")
  );
}

/** "Lamb and potatoes": a starch, a vegetable or a snack said with "and" after a heavier main goes with it. */
const isSideOf = (food: FoodProfile, before: FoodProfile) =>
  food.main !== null &&
  before.main !== null &&
  MAIN_RANK[food.main] <= 2 &&
  MAIN_RANK[before.main] > MAIN_RANK[food.main];

/**
 * A piece the engine cannot read that is still plainly a course: a word or three naming a thing ("soup", "the
 * zarzuela"), not a question about the menu, not politeness and not the sentence around it ("tonight we are
 * having").
 */
const isBareCourse = (piece: string) =>
  /\p{L}{3,}/u.test(piece) &&
  piece.trim().split(/\s+/).length <= 3 &&
  normalizeText(piece)
    .split(" ")
    .some((w) => w.length >= 3 && !STOP.has(w)) &&
  !/\?|\b(?:which|what|welke|welk|wat|wine|wijn|open|pour|schenk|drink|tonight|dinner|lunch|menu|course|courses|vanavond|diner|eten|gang|gangen|we|i|ik|wij|thanks|thank|please|cheers|bedankt|dank|graag|alsjeblieft|hi|hello|hoi|hallo)\b/i.test(
    piece,
  );

const tidyPiece = (piece: string) =>
  piece.replace(/\s+/g, " ").trim().slice(0, MAX_COURSE_SAID).trim();

/**
 * The course in the words it was typed in. The engine's own `said` is lower case and without accents
 * ("creme brulee"); this finds the same stretch in the original text ("crème brûlée"). A word the engine split
 * ("citroenbotersaus") is found by the pieces it contains. When the stretch cannot be found: the engine's words.
 */
function saidOf(piece: string, food: FoodProfile): string {
  const target = (food.said ?? "").split(" ").filter(Boolean);
  if (target.length === 0) return tidyPiece(piece);
  const words = [...piece.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    norm: normalizeText(m[0]).replace(/ /g, ""),
  }));
  let first = -1;
  let at = 0;
  for (const token of target) {
    // The same word may hold several of the engine's tokens (a compound): look from the word found last.
    // A whole word first, so that "ham" is not found inside "champagne".
    let found = words.findIndex((w, i) => i >= at && w.norm === token);
    if (found === -1) found = words.findIndex((w, i) => i >= at && w.norm.includes(token));
    if (found === -1) return tidyPiece(food.said ?? piece);
    if (first === -1) first = found;
    at = found;
  }
  return tidyPiece(piece.slice(words[first]!.start, words[at]!.end));
}

/** Every dish a text names, in the order said: for a menu ("oysters to start, then roast lamb"). */
export function parseCourses(text: string, k: FoodKnowledge): FoodProfile[] {
  // A menu has a handful of courses: the same bound as a single dish on the text, and no more than eight pieces.
  const bounded = text.slice(0, MAX_TEXT * 4);
  const pieces = bounded
    .split(
      /[;\n]|\b(?:then|followed by|after that|afterwards|to start|as a starter|for dessert|for the main|and for|daarna|vervolgens|gevolgd door|vooraf|als voorgerecht|als hoofdgerecht|als toetje|als dessert|toe)\b|,(?=\s*(?:then|and then|daarna|en dan))/gi,
    )
    .map((p) => p.trim())
    .filter((p) => p.length > 2)
    .slice(0, 8);
  const courses = pieces.map((p) => parseFood(p, k)).filter((p) => p.source !== "none");
  return courses.length > 0 ? courses : [parseFood(bounded, k)].filter((p) => p.source !== "none");
}
