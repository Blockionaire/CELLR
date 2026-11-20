import { normalizeText } from "./cellar";

/**
 * WHAT KIND OF QUESTION IS THIS, as far as words alone can tell. Some questions are recognised by how they are
 * asked ("at what temperature", "do I have enough bottles", "what should I cook with"); the rest (a dish to pair,
 * something to buy, a question about the cellar) is decided by the server from what the engines found.
 */
export const ASKED_FOR = ["serving", "keeping", "quantity", "wine-to-food", "compare"] as const;
export type AskedFor = (typeof ASKED_FOR)[number];

const PHRASES: ReadonlyArray<readonly [AskedFor, readonly string[]]> = [
  [
    "quantity",
    [
      // "How many bottles do I have" is a count of the cellar, not this: see `NEEDS` below for "how many ... need".
      "enough bottles",
      "enough wine",
      "enough of",
      "genoeg flessen",
      "genoeg wijn",
      "voldoende flessen",
      "voldoende wijn",
      "kom ik uit",
    ],
  ],
  [
    "serving",
    [
      "temperature",
      "how cold",
      "how warm",
      "how cool",
      "chill it",
      "chilled",
      "decant",
      "decanted",
      "decanting",
      "carafe",
      "which glass",
      "what glass",
      "how do i serve",
      "how should i serve",
      "how to serve",
      "let it breathe",
      "temperatuur",
      "hoe koud",
      "hoe warm",
      "koelen",
      "decanteren",
      "decanteer",
      "karaf",
      "welk glas",
      "wat voor glas",
      "hoe serveer",
      "hoe schenk",
      "chambreren",
      "laten ademen",
    ],
  ],
  [
    "keeping",
    [
      "how long can i keep",
      "how long will it keep",
      "how long can i store",
      "how long does it keep",
      "when should i drink",
      "when is it ready",
      "is it ready",
      "can i still keep",
      "hoe lang kan ik",
      "hoe lang kan hij",
      "nog bewaren",
      "bewaren",
      "wanneer drinken",
      "wanneer moet ik",
      "is hij op dronk",
      "op dronk",
    ],
  ],
  [
    "wine-to-food",
    [
      "what should i cook",
      "what can i cook",
      "what to cook",
      "what do i cook",
      "what should i eat",
      "what food goes",
      "what food should",
      "which dish",
      "what dish",
      "wat kook ik",
      "wat zal ik koken",
      "wat moet ik koken",
      "wat kan ik koken",
      "wat eet ik",
      "wat eten we",
      "welk gerecht",
      "welk eten",
      "wat past bij mijn",
    ],
  ],
];

/** "How many bottles do I need", "hoeveel wijn heb ik nodig": an amount that is needed, not one that is owned. */
const NEEDS = /\b(?:how many|how much|hoeveel)\b.{0,60}\b(?:need|needed|nodig)\b/;
/**
 * A bottle that is already open: how long it lasts then is days, and has nothing to do with its drinking window.
 * Such a question is not answered as "keeping".
 */
const ALREADY_OPEN =
  /\b(?:opened|once open|after opening|open bottle|open fles|geopend|geopende|aangebroken|na openen|na het openen)\b/;

/** The kind a question's wording points to, or null when the wording does not say. */
export function askedFor(question: string): AskedFor | null {
  const text = ` ${normalizeText(question)} `;
  for (const [kind, phrases] of PHRASES) {
    const said =
      phrases.some((p) => text.includes(` ${p} `)) || (kind === "quantity" && NEEDS.test(text));
    if (!said) continue;
    if (kind === "keeping" && ALREADY_OPEN.test(text)) return null;
    return kind;
  }
  return null;
}

/** "X or Y": a choice between two things. The server decides whether both are wines the person owns. */
export const offersChoice = (question: string): boolean =>
  / (or|of|versus|vs) /.test(` ${normalizeText(question)} `);

/**
 * Words (and beginnings of words) that show a question is about wine, a cellar or a meal, when no dish and no
 * wine was recognised in it. Such a question is for the general sommelier.
 */
const TOPIC_STEMS = [
  "wine",
  "wijn",
  "bottle",
  "fles",
  "cellar",
  "kelder",
  "fridge",
  "koelkast",
  "rack",
  "drink",
  "pour",
  "schenk",
  "open",
  "serv",
  "decant",
  "karaf",
  "temperatu",
  "chill",
  "koel",
  "dinner",
  "diner",
  "lunch",
  "eten",
  "eat",
  "cook",
  "kook",
  "pairing",
  "sommelier",
  "glass",
  "glas",
  "glaz",
  "vintage",
  "jaargang",
  "grape",
  "druif",
  "druiv",
  "region",
  "streek",
  "tannin",
  "champagne",
  "bubbl",
  "bubbel",
  "valuable",
  "waard",
  "worth",
  "birthday",
  "verjaardag",
  "party",
  "feest",
  "guests",
  "gasten",
  "taste",
  "smaak",
];
const TOPIC_WORDS = [
  "red",
  "reds",
  "white",
  "whites",
  "rood",
  "wit",
  "rose",
  "buy",
  "bought",
  "kopen",
  "gekocht",
];
/** A word or two of politeness: not a question to answer with a question. */
const SMALL_TALK =
  /^(thanks?( you)?( very much)?|thx|ok(ay)?|great|perfect|nice|hi|hello|hey|bye|cheers|dank( je| u)?( wel)?|bedankt|top|prima|hoi|hallo|doei|proost)[ .!]*$/;

export const aboutWine = (question: string): boolean => {
  const tokens = normalizeText(question).split(" ");
  return tokens.some(
    (t) => TOPIC_WORDS.includes(t) || TOPIC_STEMS.some((stem) => t.startsWith(stem)),
  );
};
export const isSmallTalk = (question: string): boolean => SMALL_TALK.test(normalizeText(question));

/**
 * Whether the wording asks which wine to pour with something ("which wine with the steak", "wat schenk ik bij de
 * lasagne"). With a dish in the same question that makes it a pairing, whatever else the question mentions: a
 * bottle the person wants to keep, or one they do not want to decant.
 */
const PAIRING_ASK =
  /\b(?:which|what|welke|welk|wat)\b.{0,24}\b(?:wine|wines|bottle|red|white|wijn|wijnen|fles|rode|witte)\b.{0,40}\b(?:with|for|bij|voor|met)\b|\bwhat (?:should|shall|do|can|could) (?:i|we) (?:open|pour|serve|drink)\b|\bwat (?:schenk|drink|open|serveer) (?:ik|we)\b|\bwat (?:zal|kan|moet) ik (?:schenken|drinken|openen|opentrekken)\b|\b(?:goes|go|pairs?) with\b|\bwat past bij\b|\bwat drinken we\b/;
export function asksPairing(question: string): boolean {
  return PAIRING_ASK.test(normalizeText(question));
}

/** "the Barolo or the Chablis": a choice between wines is being asked for. */
export function asksWhichOf(question: string): boolean {
  return /\b(?:or|of)\b/.test(normalizeText(question));
}
