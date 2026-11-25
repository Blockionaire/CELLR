import { z } from "zod";
import type { CellarItem } from "./cellar";
import { labelNameWords, type BottleAnnotation } from "./sommelier-annotate";

/**
 * THE CARD'S SERVING FACTS LEAD (Sommelier V1+ part `annotate`, owner decision). The app shows, under each card, a
 * serving temperature, a decanting advice and a drinking window it worked out itself. The model's words may not
 * state another one as fact: every sentence that gives a temperature, an airing time or drinking years for a wine
 * on the cards that contradicts that card is taken out. Deterministic, sentence by sentence, English and Dutch; no
 * second model call. Precise rather than eager: a doubtful sentence stays, a clear numeric contradiction goes.
 *
 * Which wine a sentence is about: the cards it names (a word of the producer or the wine's name). With one card,
 * every sentence is about it. With several and no name, a claim goes only when it fits none of them.
 *
 * What it cannot see (known limits, on purpose):
 *  - a claim without a number ("serve it well chilled", "give it plenty of air") is never checked;
 *  - "it" in a later sentence is not followed back to the wine the sentence before named;
 *  - a temperature without a unit ("serve at 16") is not read: "16" could be anything;
 *  - "room temperature" is read as 20–22 °C, whatever the room;
 *  - a year equal to a card's vintage, or next to a wine's name or "the", is never read as a drinking year;
 *  - sentences are split at ". ", "! ", "? " and line ends: "e.g. 16 °C" may be split, which only ever keeps more;
 *  - questions and conditionals ("if you like it cooler, 12 °C") are left as they are, whatever they say.
 */

export const SERVING_CLAIM_CODES = ["temperature", "decanting", "window"] as const;
export type ServingClaimCode = (typeof SERVING_CLAIM_CODES)[number];

export interface ServingClaimsResult {
  /** The text without the sentences that contradict a card's facts; null when no sentence is left. */
  text: string | null;
  /** What was found, as closed codes, each once, in this order. Never the model's words. */
  codes: ServingClaimCode[];
}

export interface ServingCheck {
  v: 1;
  text: "kept" | "trimmed" | "replaced";
  codes: ServingClaimCode[];
}

export const ServingCheckSchema: z.ZodType<ServingCheck> = z.object({
  v: z.literal(1),
  text: z.enum(["kept", "trimmed", "replaced"]),
  codes: z.array(z.enum(SERVING_CLAIM_CODES)).max(SERVING_CLAIM_CODES.length),
});

/** The stored record of a reconciliation: what happened to the text, and what was found. */
export function servingCheckOf(result: ServingClaimsResult): ServingCheck {
  return {
    v: 1,
    text: result.codes.length === 0 ? "kept" : result.text === null ? "replaced" : "trimmed",
    codes: [...result.codes],
  };
}

// ---- Reading a sentence ----------------------------------------------------------------------------------------

type Range = readonly [number, number];

/** Lower case, no accents, one kind of dash and apostrophe; punctuation and ° stay. */
const fold = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’`´]/g, "'");

const NUM = String.raw`(\d{1,3}(?:[.,]\d{1,2})?)`;
const value = (said: string) => Number(said.replace(",", "."));
const ordered = (a: number, b: number): Range => (a <= b ? [a, b] : [b, a]);

// Temperatures: a number (or a range) with a unit. Fahrenheit is converted.
const UNIT = String.raw`(°\s*[cf]?\b|°|º\s*[cf]?|degrees?(?:\s+(?:celsius|fahrenheit|c|f)\b)?|graden(?:\s+(?:celsius|fahrenheit)\b)?|celsius|fahrenheit|(?<=\d)[cf]\b)`;
const TEMP_RANGE = new RegExp(
  String.raw`(?<![\d.,])${NUM}\s*(?:°\s*[cf]?|º|degrees?|graden)?\s*(?:-|to|tot|and|en|or|of)\s*${NUM}\s*${UNIT}`,
  "g",
);
const TEMP_ONE = new RegExp(String.raw`(?<![\d.,])${NUM}\s*${UNIT}`, "g");
const ROOM = /\b(?:room temperature|kamertemperatuur)\b/g;
/** "Below room temperature", "from room temperature" (a fridge's start): not a serving temperature. */
const ROOM_NOT =
  /\b(?:not|never|below|under|cooler than|colder than|than|from|niet|nooit|onder|koeler dan|kouder dan|dan|vanaf|van)\s+(?:at\s+|op\s+|the\s+|de\s+)?$/;

function celsius(range: Range, unit: string): Range {
  const f = /fahrenheit|[°º]\s*f|degrees?\s+f\b|^f$/.test(unit.trim());
  return f ? [((range[0] - 32) * 5) / 9, ((range[1] - 32) * 5) / 9] : range;
}
/** "Two degrees cooler", "3 graden warmer", "13.5 degrees of alcohol": not a serving temperature. */
const RELATIVE =
  /^\s*(?:warmer|cooler|colder|higher|lower|more|less|above|below|over|under|kouder|koeler|hoger|lager|meer|minder|boven|onder|of\b|alcohol|abv|vol\b|proof|plato|brix|oechsle)/;
/** A temperature a wine could be served at, in °C; anything else (an oven, a typo) is not this. */
const servable = (r: Range) => r[0] >= -2 && r[1] <= 30;

function temperaturesIn(s: string): Range[] {
  const found: Range[] = [];
  let rest = s;
  const after = (m: RegExpMatchArray, from: string) =>
    from.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 12);
  for (const m of s.matchAll(TEMP_RANGE)) {
    const r = celsius(ordered(value(m[1]!), value(m[2]!)), m[3]!);
    if (servable(r) && !RELATIVE.test(after(m, s))) found.push(r);
    rest = rest.replace(m[0], " ".repeat(m[0].length));
  }
  for (const m of rest.matchAll(TEMP_ONE)) {
    const v = value(m[1]!);
    const r = celsius([v, v], m[2]!);
    if (servable(r) && !RELATIVE.test(after(m, rest))) found.push(r);
  }
  for (const m of s.matchAll(ROOM))
    if (!ROOM_NOT.test(s.slice(Math.max(0, (m.index ?? 0) - 20), m.index))) found.push([20, 22]);
  return found;
}

// Airing: a time near a word for decanting or airing. Times for the oven or the fridge are not this.
const AIR_WORDS =
  /\b(?:decant\w*|aerat\w*|air|airing|aired|breathe|breathing|carafe|decanter|open(?:ed|ing)?\b.{0,30}\b(?:ahead|in advance|beforehand|before serving|early)|uncork\w*\b.{0,30}\b(?:ahead|in advance|before)|decanteer\w*|decanteren|gedecanteerd|belucht\w*|karaf|ademen|lucht|van tevoren open\w*|open\w*\b.{0,30}\bvan tevoren|vooraf open\w*|ontkurk\w*\b.{0,30}\b(?:van tevoren|vooraf))\b/;
const NOT_AIR =
  /\b(?:oven|roast\w*|bake\w*|baking|cook\w*|simmer\w*|braise\w*|rest\w*|marinat\w*|grill\w*|fridge|refrigerat\w*|freezer|ice|bucket|chill\w*|cool\w*|koelkast|vriezer|ijs\w*|braad\w*|braden|bakk\w*|bakken|kook\w*|koken|sudder\w*|stoof\w*|stoven|marine\w*|grill\w*|koel\w*)\b/;
const NO_DECANT =
  /\b(?:no need to (?:decant|aerate|air)|don'?t (?:need to )?(?:decant|aerate)|do not (?:need to )?(?:decant|aerate)|does ?n'?t need (?:to be )?(?:decant\w*|air\w*)|does not need (?:to be )?(?:decant\w*|air\w*)|no decanting|without decanting|needs no (?:decanting|air)|never decant|niet decanteren|niet te decanteren|hoeft niet (?:te worden )?gedecanteerd|decanteren hoeft niet|hoeft niet gedecanteerd|geen decanteren|zonder decanteren|hoeft niet (?:in de )?karaf|karaf hoeft niet|niet beluchten)\b/;

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  "forty five": 45,
  "forty-five": 45,
  sixty: 60,
  ninety: 90,
  een: 1,
  twee: 2,
  drie: 3,
  vier: 4,
  vijf: 5,
  zes: 6,
  tien: 10,
  vijftien: 15,
  twintig: 20,
  dertig: 30,
  veertig: 40,
  vijfenveertig: 45,
  zestig: 60,
  negentig: 90,
};
const WORD_NUM = `(?:${Object.keys(WORD_NUMBERS)
  .sort((a, b) => b.length - a.length)
  .join("|")})`;
const DUR_NUM = String.raw`(\d{1,3}(?:[.,]\d)?|${WORD_NUM})`;
const MINUTES = String.raw`(?:minutes?|mins?|minuten|minuutjes?|min)\b`;
const HOURS = String.raw`(?:hours?|hrs?|h|uur|uurtje|uren)\b`;
const durValue = (said: string) => WORD_NUMBERS[said] ?? Number(said.replace(",", "."));

/** Phrases first (longest first), then numbers with a unit. Each match is masked so it is read once. */
const DURATION_PHRASES: ReadonlyArray<readonly [RegExp, Range]> = [
  [
    /\b(?:an|one) hour and a half\b|\b(?:one and a half|1\.5|1,5) hours?\b|\banderhalf uur\b|\banderhalve uur\b|\banderhalf uurtje\b/g,
    [90, 90],
  ],
  [/\ba couple of hours\b|\btwo hours\b|\btwee uur\b|\btwee uren\b/g, [120, 120]],
  [
    /\ba few hours\b|\bseveral hours\b|\been paar uur\b|\benkele uren\b|\been aantal uren\b/g,
    [120, 180],
  ],
  [/\ban hour or two\b|\been uur of twee\b|\been à twee uur\b/g, [60, 120]],
  [
    /\bhalf an hour\b|\ba half hour\b|\bhalf hour\b|\been half uur(?:tje)?\b|\bhalfuur\b|\been halfuur\b/g,
    [30, 30],
  ],
  [/\b(?:a )?quarter of an hour\b|\been kwartier(?:tje)?\b|\bkwartier\b/g, [15, 15]],
  [/\b(?:an|one) hour\b|\been uur(?:tje)?\b/g, [60, 60]],
];
const DUR_RANGE = new RegExp(
  String.raw`${DUR_NUM}\s*(?:-|to|tot|or|of|à)\s*${DUR_NUM}\s*(${MINUTES}|${HOURS})`,
  "g",
);
const DUR_ONE = new RegExp(String.raw`${DUR_NUM}\s*(${MINUTES}|${HOURS})`, "g");
const inMinutes = (n: number, unit: string) =>
  /^(?:h|hours?|hrs?|uur|uurtje|uren)$/.test(unit.trim()) ? n * 60 : n;

/** Airing times in one clause, in minutes. */
function durationsIn(clause: string): Range[] {
  const found: Range[] = [];
  let rest = clause;
  for (const [pattern, range] of DURATION_PHRASES)
    rest = rest.replace(pattern, (m) => {
      found.push(range);
      return " ".repeat(m.length);
    });
  const rangeRest = rest;
  for (const m of rangeRest.matchAll(DUR_RANGE)) {
    const unit = m[3]!;
    found.push(ordered(inMinutes(durValue(m[1]!), unit), inMinutes(durValue(m[2]!), unit)));
    rest = rest.replace(m[0], " ".repeat(m[0].length));
  }
  for (const m of rest.matchAll(DUR_ONE)) {
    const v = inMinutes(durValue(m[1]!), m[2]!);
    found.push([v, v]);
  }
  return found.filter((r) => Number.isFinite(r[0]) && r[1] > 0 && r[1] <= 24 * 60);
}

function airingsIn(s: string): { times: Range[]; none: boolean } {
  if (!AIR_WORDS.test(s)) return { times: [], none: false };
  const none = NO_DECANT.test(s);
  // The clauses of the sentence: a time for the oven or the fridge in its own clause is not an airing time.
  const times = s
    .split(/[,;:()]|\b(?:but|then|and then|maar|dan|daarna)\b/)
    .filter((clause) => !NOT_AIR.test(clause))
    .flatMap(durationsIn);
  return { times, none };
}

// Drinking years.
const YEAR = String.raw`((?:19|20)\d\d)`;
const DRINK_CONTEXT =
  /\b(?:drink\w*|peak\w*|window|best|ready|keep\w*|kept|cellar\w*|matur\w*|age\w*|hold|last\w*|improv\w*|op dronk|dronk|drinkvenster|venster|bewaren|bewaar\w*|houdbaar|hoogtepunt|top|rijp\w*|optimaal|ideal\w*)\b/;
const ABOUT = String.raw`(?:(?:about|around|circa|roughly|ongeveer|rond|zo'?n)\s+)?`;
const END = new RegExp(
  String.raw`\b(?:drink(?:\s+(?:it|them|this))?\s+(?:by|before|until|till|up to|within|through)|(?:best|ideally)\s+(?:before|by|until|till)|(?:keep|keeps|kept|hold|cellar|last|lasts|age|ages|improve|improves|good|drinkable|peak|at its best|at its peak)\s+(?:it\s+|well\s+)?(?:until|till|to|through|into)|until|till|through|op dronk tot|drinken\s+(?:voor|tot|uiterlijk|binnen)|drink\s+(?:hem\s+|het\s+)?(?:voor|tot|uiterlijk)|bewaren\s+tot|te bewaren tot|houdbaar tot|tot|uiterlijk|tot en met|t\/m)\s+${ABOUT}${YEAR}\b`,
  "g",
);
const START = new RegExp(
  String.raw`\b(?:from|after|not before|ready (?:in|from|by|around)|starting(?:\s+(?:in|from))?|vanaf|na|niet voor|op dronk vanaf|klaar vanaf|drinkbaar vanaf|open\w*\s+(?:it\s+)?(?:from|after))\s+${ABOUT}${YEAR}\b`,
  "g",
);
const SPAN = new RegExp(
  String.raw`\b${YEAR}\s*(?:-|to|tot|until|till|and|en|through)\s*${YEAR}\b`,
  "g",
);

/** A year that is a vintage, not a drinking year: "the 2018", "Barolo 2018", "2018 vintage", the card's own year. */
function withoutVintages(
  s: string,
  vintages: ReadonlySet<number>,
  names: readonly string[],
): string {
  let out = s
    .replace(
      /\b(the|a|de|het|this|that|these|deze|die|dat|your|je|jouw|uw|my|mijn|our|onze|its|zijn|een)\s+((?:19|20)\d\d)\b/g,
      "$1 vintage",
    )
    .replace(/\b((?:19|20)\d\d)\s+(vintage|jaargang|oogst)\b/g, "vintage $2")
    .replace(/\b(vintage|jaargang|oogst)\s+((?:19|20)\d\d)\b/g, "$1 vintage");
  for (const name of names)
    out = out.replace(new RegExp(String.raw`\b(${name})\s+((?:19|20)\d\d)\b`, "g"), "$1 vintage");
  return out.replace(/\b(?:19|20)\d\d\b/g, (y) => (vintages.has(Number(y)) ? "vintage" : y));
}

interface Years {
  ends: number[];
  starts: number[];
}
function yearsIn(s: string): Years {
  const ends: number[] = [];
  const starts: number[] = [];
  // "Until 2030" with no word about drinking or keeping could be about anything: left alone.
  if (!DRINK_CONTEXT.test(s)) return { ends, starts };
  let rest = s;
  for (const m of s.matchAll(SPAN)) {
    const [a, b] = ordered(Number(m[1]), Number(m[2]));
    starts.push(a);
    ends.push(b);
    rest = rest.replace(m[0], " ".repeat(m[0].length));
  }
  for (const m of rest.matchAll(END)) ends.push(Number(m[1]));
  for (const m of rest.matchAll(START)) starts.push(Number(m[1]));
  return { ends, starts };
}

// ---- Judging a claim against a card ----------------------------------------------------------------------------

interface Claim {
  code: ServingClaimCode;
  /** True when this claim contradicts the card's facts. */
  against: (a: BottleAnnotation) => boolean;
}

function claimsIn(s: string): Claim[] {
  const claims: Claim[] = [];
  for (const [lo, hi] of temperaturesIn(s))
    claims.push({
      code: "temperature",
      // No temperature on the card: a fact the app does not have, so nothing to contradict.
      against: (a) =>
        a.serving !== null && (hi < a.serving.tempC.min - 1 || lo > a.serving.tempC.max + 1),
    });
  const air = airingsIn(s);
  for (const [lo, hi] of air.times)
    claims.push({
      code: "decanting",
      against: (a) => {
        const d = a.serving?.decant ?? null;
        if (d === null) return false;
        if (d.kind === "no" || d.kind === "sediment") return lo >= 30;
        if (d.minutes <= 0) return false;
        return hi < d.minutes / 2 || lo > d.minutes * 2;
      },
    });
  if (air.none)
    claims.push({
      code: "decanting",
      against: (a) => a.serving?.decant?.kind === "air",
    });
  const { ends, starts } = yearsIn(s);
  const year = (y: number, pick: (a: BottleAnnotation) => number | null) => ({
    code: "window" as const,
    against: (a: BottleAnnotation) => {
      // The app says it does not know when to drink it: any year said as fact contradicts that.
      if (a.drink.advice === "unknown") return true;
      const own = pick(a);
      return own !== null && Math.abs(own - y) > 1;
    },
  });
  for (const y of ends) claims.push(year(y, (a) => a.drink.until));
  for (const y of starts) claims.push(year(y, (a) => a.drink.from));
  return claims;
}

/** A question, or a condition: not said as fact. */
const NOT_FACT =
  /\?\s*["'*_)\]]*\s*$|\b(?:if|unless|should you|in case|indien|mocht|tenzij|als (?:je|u|jij|jullie|het|hij|ze|we|men))\b/;

// ---- The text --------------------------------------------------------------------------------------------------

type Card = {
  item: Pick<CellarItem, "vintageId" | "producer" | "wineName" | "year">;
  annotation: BottleAnnotation;
};

const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Removes from the model's words every sentence that states, as fact, a serving temperature, a decanting or airing
 * time, or drinking years for a wine on the cards that contradicts that card's annotation.
 */
export function reconcileServingClaims(
  text: string,
  cards: ReadonlyArray<Card>,
): ServingClaimsResult {
  if (cards.length === 0 || text.trim() === "")
    return { text: text.trim() === "" ? null : text, codes: [] };
  const named = cards.map((c) => ({
    card: c,
    words: labelNameWords(`${c.item.producer} ${c.item.wineName}`),
  }));
  const vintages = new Set(cards.flatMap((c) => (c.item.year === null ? [] : [c.item.year])));
  const nameTokens = [
    ...new Set(
      cards.flatMap((c) =>
        fold(`${c.item.producer} ${c.item.wineName}`)
          .split(/[^\p{L}\p{N}]+/u)
          .filter((w) => w.length >= 3 && !/^\d+$/.test(w))
          .map(escape),
      ),
    ),
  ];
  const found = new Set<ServingClaimCode>();

  const judge = (sentence: string): boolean => {
    const s = fold(sentence);
    if (
      !/\d|room temperature|kamertemperatuur|hour|uur|minut|kwartier/.test(s) &&
      !NO_DECANT.test(s)
    )
      return true;
    if (NOT_FACT.test(s)) return true;
    const tokens = new Set(s.split(/[^\p{L}\p{N}]+/u));
    const about = named.filter((n) => n.words.some((w) => tokens.has(w))).map((n) => n.card);
    const relevant = about.length > 0 ? about : cards;
    const claims = claimsIn(withoutVintages(s, vintages, nameTokens));
    let keep = true;
    for (const claim of claims)
      if (relevant.every((c) => claim.against(c.annotation))) {
        found.add(claim.code);
        keep = false;
      }
    return keep;
  };

  const lines = text.split("\n").map((line) => {
    if (line.trim() === "") return { line, removed: false };
    const sentences = line.split(/(?<=[.!?…])\s+/);
    const kept = sentences.filter(judge);
    if (kept.length === sentences.length) return { line, removed: false };
    return { line: kept.join(" "), removed: true };
  });
  if (found.size === 0) return { text, codes: [] };
  const out = lines
    // A line whose every sentence went is gone, with its bullet; what is left of a line keeps its start.
    .filter(
      (l) => !(l.removed && !/[\p{L}\p{N}]/u.test(l.line.replace(/^\s*(?:[-*+]|\d+[.)])\s*/, ""))),
    )
    .map((l) => l.line.replace(/[ \t]{2,}/g, " ").replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    text: /[\p{L}\p{N}]/u.test(out) ? out : null,
    codes: SERVING_CLAIM_CODES.filter((c) => found.has(c)),
  };
}
