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
  `a an the and or of in on at to for from by with without as is are was be been it its this that these those i me
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
const NEGATION = new Set(["without", "zonder", "no", "geen", "not", "niet", "minus", "hold"]);

/** Endings a word may carry beyond its dictionary form (Dutch and English plurals and inflections). */
const ENDINGS = ["", "s", "es", "en", "e", "n", "jes", "je", "tjes", "tje", "'s"];

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
  return null;
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
  if (word.length < 7) return null;
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
  negated: boolean;
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

function scan(text: string, lex: Lexicon): { found: Found[]; unknown: string[] } {
  const raw = normalizeText(text).split(" ").filter(Boolean);
  // Compounds first: "citroenbotersaus" becomes "citroen botersaus" when both are known.
  const tokens: string[] = [];
  for (const word of raw) {
    if (lex.phrases.has(word) || STOP.has(word) || lookupWord(word, lex)) tokens.push(word);
    else tokens.push(...(decompound(word, lex) ?? [word]));
  }
  const found: Found[] = [];
  const unknown: string[] = [];
  let negate = false;
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
      found.push({ entry: matched.entries[0]!, at: i, negated: negate });
      negate = false;
      i += matched.length;
    } else {
      if (NEGATION.has(token)) negate = true;
      else if (!STOP.has(token) && !GLUE.has(token) && token.length > 2 && !/^\d+$/.test(token)) {
        unknown.push(token);
      }
      i += 1;
    }
  }
  return { found: found.filter((f) => !f.negated), unknown };
}

const EMPTY: FoodProfile = {
  source: "none",
  dishId: null,
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
  const { found, unknown } = scan(text.slice(0, 600), lex);
  const of = <K extends Entry["kind"]>(kind: K) =>
    found
      .filter((f) => f.entry.kind === kind)
      .map((f) => f.entry.item as Extract<Entry, { kind: K }>["item"]);
  const dishes = of("dish");
  const sauces = uniq(of("sauce")).sort((a, b) => b.dominance - a.dominance);
  const techniques = uniq(of("technique"));
  const ingredients = uniq(of("ingredient"));
  if (dishes.length + sauces.length + techniques.length + ingredients.length === 0)
    return { ...EMPTY, unknown };

  const dish = dishes[0] ?? null;
  let parts: DishParts;
  let main: FoodMain | null;
  if (dish) {
    const own = templateParts(dish, k);
    const named = new Set([dish.main, ...(dish.with ?? [])]);
    parts = {
      ...own,
      extras: [...(own.extras ?? []), ...ingredients.filter((i) => !named.has(i.id))],
      // What the person adds to a known dish ("steak with béarnaise") is said on top of what the dish has.
      moreSauces: sauces.filter((s) => s.id !== dish.sauce),
      moreTechniques: own.technique ? [] : techniques.slice(0, 1),
    };
    main = dish.mainAs ?? own.main?.main ?? null;
  } else {
    const mains = ingredients
      .filter((i) => i.main !== undefined)
      .map((i, order) => ({ i, order }))
      .sort((a, b) => MAIN_RANK[b.i.main!] - MAIN_RANK[a.i.main!] || a.order - b.order);
    const chosen = mains[0]?.i ?? null;
    parts = {
      main: chosen,
      technique: techniques[0] ?? null,
      sauce: sauces[0] ?? null,
      extras: ingredients.filter((i) => i.id !== chosen?.id),
      moreSauces: sauces.slice(1),
    };
    main = chosen?.main ?? null;
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
    main,
    structure,
    tags,
    classics: [...(dish?.classics ?? [])],
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

/** Every dish a text names, in the order said: for a menu ("oysters to start, then roast lamb"). */
export function parseCourses(text: string, k: FoodKnowledge): FoodProfile[] {
  const pieces = text
    .split(
      /[;\n]|\b(?:then|followed by|after that|afterwards|to start|as a starter|for dessert|for the main|and for|daarna|vervolgens|gevolgd door|vooraf|als voorgerecht|als hoofdgerecht|als toetje|als dessert|toe)\b|,(?=\s*(?:then|and then|daarna|en dan))/gi,
    )
    .map((p) => p.trim())
    .filter((p) => p.length > 2);
  const courses = pieces.map((p) => parseFood(p, k)).filter((p) => p.source !== "none");
  return courses.length > 0 ? courses : [parseFood(text, k)].filter((p) => p.source !== "none");
}
