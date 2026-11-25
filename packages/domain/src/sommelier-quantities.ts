import { z } from "zod";
import { normalizeText, type WineType } from "./cellar";
import {
  BOTTLES_PER_PERSON,
  bottlesFor,
  enoughFor,
  GATHERINGS,
  type Gathering,
} from "./experiences/quantity";
import type { ChatMessage } from "./sommelier";

export { GATHERINGS, type Gathering };

/**
 * BOTTLES FOR A NUMBER OF GUESTS, next to the sommelier's choice (Sommelier V1+ part `quantities`, P5). The model
 * chooses the wines; how many people are drinking is read from what the person said, and the arithmetic (bottles
 * needed, bottles free to open, how many short) is done here, never by the model. What is read is only ever a
 * number the person stated: "a few friends" is not a number, "2015" is a year and "3 bottles" are bottles.
 *
 * What the reading cannot see (known limits, on purpose):
 *  - a correction worded as a difference ("two more are coming") is not added up; a new number replaces the old;
 *  - a count spread over two sentences ("we are with my parents. And the kids, 3 of them") is not combined;
 *  - number words are read up to "ninety nine" / "negenennegentig", plus "a dozen", "honderd" and "hundred";
 *  - the gathering (dinner, a reception, a long evening) comes from a few words; everything else is a dinner.
 */

/** The fewest and the most people a statement may name; anything else is not believed to be a guest count. */
export const GUESTS_MIN = 1;
export const GUESTS_MAX = 500;

export interface GuestCount {
  guests: number;
  gathering: Gathering;
}

// ---- Numbers in words ----------------------------------------------------------------------------------------

const EN_UNITS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const EN_TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const NL_UNITS: Record<string, number> = {
  een: 1,
  twee: 2,
  drie: 3,
  vier: 4,
  vijf: 5,
  zes: 6,
  zeven: 7,
  acht: 8,
  negen: 9,
  tien: 10,
  elf: 11,
  twaalf: 12,
  dertien: 13,
  veertien: 14,
  vijftien: 15,
  zestien: 16,
  zeventien: 17,
  achttien: 18,
  negentien: 19,
};
const NL_TENS: Record<string, number> = {
  twintig: 20,
  dertig: 30,
  veertig: 40,
  vijftig: 50,
  zestig: 60,
  zeventig: 70,
  tachtig: 80,
  negentig: 90,
};
/** "Met z'n achten": the collective form of a Dutch number. */
const NL_COLLECTIVE: Record<string, number> = {
  tweeen: 2,
  drieen: 3,
  vieren: 4,
  vijven: 5,
  zessen: 6,
  zevenen: 7,
  achten: 8,
  negenen: 9,
  tienen: 10,
  elven: 11,
  twaalven: 12,
  dertienen: 13,
  veertienen: 14,
  vijftienen: 15,
  zestienen: 16,
  tweetjes: 2,
  twintigen: 20,
  dertigen: 30,
  veertigen: 40,
  vijftigen: 50,
};

/** A Dutch compound like "vierentwintig" (four-and-twenty), or a plain unit or ten. */
function dutchNumber(word: string): number | null {
  if (word in NL_UNITS) return NL_UNITS[word]!;
  if (word in NL_TENS) return NL_TENS[word]!;
  if (word === "honderd") return 100;
  const compound =
    /^(een|twee|drie|vier|vijf|zes|zeven|acht|negen)en(twintig|dertig|veertig|vijftig|zestig|zeventig|tachtig|negentig)$/.exec(
      word,
    );
  return compound ? NL_UNITS[compound[1]!]! + NL_TENS[compound[2]!]! : null;
}

/**
 * The words of a number, as one alternation for a regular expression: digits, English words (with "twenty four"
 * as two words), Dutch words and compounds. Read back with `numberValue`.
 */
const EN_WORD = `(?:(?:${Object.keys(EN_TENS).join("|")})(?: (?:${Object.keys(EN_UNITS).slice(0, 9).join("|")}))?|${Object.keys(EN_UNITS).join("|")}|a dozen|two dozen|a hundred|one hundred|hundred)`;
const NL_WORD = `(?:(?:een|twee|drie|vier|vijf|zes|zeven|acht|negen)en(?:twintig|dertig|veertig|vijftig|zestig|zeventig|tachtig|negentig)|${[...Object.keys(NL_UNITS), ...Object.keys(NL_TENS)].join("|")}|honderd)`;
const NUMBER = `(\\d{1,4}|${EN_WORD}|${NL_WORD})`;

function numberValue(said: string): number | null {
  if (/^\d+$/.test(said)) return Number(said);
  if (said === "a dozen") return 12;
  if (said === "two dozen") return 24;
  if (said === "a hundred" || said === "one hundred" || said === "hundred") return 100;
  const [first, second] = said.split(" ");
  if (first && first in EN_TENS)
    return EN_TENS[first]! + (second && second in EN_UNITS ? EN_UNITS[second]! : 0);
  if (first && first in EN_UNITS) return EN_UNITS[first]!;
  return dutchNumber(said);
}

// ---- Statements of how many people ---------------------------------------------------------------------------

/** Words that make a number something else than people: "we are 3 bottles short" is not three guests. */
const NOT_PEOPLE =
  "(?:bottles?|flessen|fles|glass(?:es)?|glazen|glas|years?|jaar|jaren|euros?|eur|dollars?|pounds?|minutes?|minuten|hours?|uur|degrees?|graden|c|cl|ml|l|liters?|litres?|kg|days?|dagen|dag|weeks?|weken|courses?|gangen|gang|wines?|wijnen|short|tekort|te weinig|percent|procent|kids?|children|child|kinderen|kind|kinders|toddlers|babies|baby)";

/**
 * People, as a noun after the number ("8 guests", "12 personen", "6 man"). `couples` count double. "Friends" is
 * not read: "dinner with 4 friends" may be four or five people, and which one is a guess.
 */
const PEOPLE =
  "(guests?|people|persons?|adults?|pax|of us|couples|gasten|gast|personen|persoon|mensen|man|eters|volwassenen|stellen|koppels)";

interface Rule {
  pattern: RegExp;
  /** Which group holds the number, and which (if any) the noun. */
  number: number;
  noun?: number;
}

const RULES: readonly Rule[] = [
  // "8 guests", "for 12 people", "the two of us", "4 couples", "8 gasten", "met 6 personen", "10 man".
  { pattern: new RegExp(`\\b${NUMBER} ${PEOPLE}\\b`, "g"), number: 1, noun: 2 },
  // "we are 8", "we're 8", "we will be 8". "There are 3" is not here: "there are 3 Barolos in my cellar" counts
  // wines. "There are 8 of us", "there will be 8 people" are read by the rule above, by their noun.
  {
    pattern: new RegExp(
      `\\b(?:we are|we re|we ll be|we will be|we ll be with|we are with) ${NUMBER}\\b(?! ${NOT_PEOPLE}\\b)`,
      "g",
    ),
    number: 1,
  },
  // "dinner for eight", "table for 6", "a party of 10", "a group of 12", "diner voor acht", "groep van 12".
  {
    pattern: new RegExp(
      `\\b(?:dinner|lunch|brunch|supper|meal|table|party|group|barbecue|bbq|diner|etentje|tafel|feest|borrel|groep|gezelschap) (?:for|of|voor|van) ${NUMBER}\\b(?! ${NOT_PEOPLE}\\b)`,
      "g",
    ),
    number: 1,
  },
  // "we zijn met 6", "we zijn 6", "we zijn met z'n zessen", "met ons achten", "met zijn 8en".
  {
    pattern: new RegExp(
      `\\b(?:we zijn|wij zijn|we worden|wij worden|we zitten|wij zitten)(?: met)? ${NUMBER}\\b(?! ${NOT_PEOPLE}\\b)`,
      "g",
    ),
    number: 1,
  },
  {
    pattern: new RegExp(
      `\\bmet (?:z n|zn|zijn|ons|onze|jullie|hun) (${Object.keys(NL_COLLECTIVE).join("|")}|\\d{1,3}en)\\b`,
      "g",
    ),
    number: 1,
  },
  // "wij tweeën", "we tweetjes". Only two: "we vieren" is "we celebrate".
  { pattern: /\b(?:wij|we|ons) (tweeen|tweetjes)\b/g, number: 1 },
];

/**
 * Only the person drinks ("just me", "alleen ik", "in mijn eentje"): no gathering to count bottles for. Said after a
 * number of people, it replaces it ("we are 8 on Saturday" … "and tonight it's just me"). "Just me and my wife" is
 * not this (and is not read as a number either); "just me, with pasta" is.
 */
const SOLO =
  /\b(?:just me|only me|just myself|by myself|on my own|i am alone|i m alone|alone tonight|eating alone|drinking alone|dining alone|alleen ik|alleen mezelf|alleen voor mij|voor mij alleen|voor mezelf|in mijn eentje|in m n eentje|in mn eentje|ik ben alleen|ik eet alleen|ik drink alleen)\b(?! (?:and|en|plus)\b)/g;

/** Where the last "only me" of a text is, or -1. */
function lastSoloIn(text: string): number {
  let at = -1;
  for (const match of text.matchAll(SOLO)) at = match.index ?? at;
  return at;
}

function collective(word: string): number | null {
  if (word in NL_COLLECTIVE) return NL_COLLECTIVE[word]!;
  const digits = /^(\d{1,3})en$/.exec(word);
  return digits ? Number(digits[1]) : null;
}

/**
 * The last statement of a number of people in one text, by position, or null. A statement inside a longer one is
 * part of it, not a second statement: "twenty four of us" is 24, not also "four of us".
 */
function lastCountIn(text: string): { guests: number; at: number } | null {
  const found: Array<{ guests: number; at: number; end: number }> = [];
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      const said = match[rule.number]!;
      const value = numberValue(said) ?? collective(said);
      if (value === null) continue;
      const noun = rule.noun === undefined ? null : match[rule.noun];
      // "We are one family", "we zijn een groep van 12", "een man van zestig": "one" is too often not a count.
      if (value === 1 && (noun === null || noun === "man")) continue;
      const guests =
        noun === "couples" || noun === "stellen" || noun === "koppels" ? value * 2 : value;
      if (guests < GUESTS_MIN || guests > GUESTS_MAX) continue;
      const at = match.index ?? 0;
      found.push({ guests, at, end: at + match[0].length });
    }
  }
  const whole = found.filter(
    (m) =>
      !found.some((n) => n !== m && n.at < m.at && n.end >= m.end && n.end - n.at > m.end - m.at),
  );
  let best: { guests: number; at: number } | null = null;
  for (const m of whole) if (!best || m.at >= best.at) best = { guests: m.guests, at: m.at };
  return best;
}

/** What kind of gathering a text says, if any. A reception (one wine, standing) drinks less, a long evening more. */
const RECEPTION =
  /\b(?:reception|drinks party|cocktail|cocktails|aperitif|apero|receptie|borrel|aperitief)\b/;
const LONG_EVENING =
  /\b(?:long evening|all evening|all night|whole evening|whole night|the whole night|lange avond|hele avond|hele nacht|tot laat|until late|till late)\b/;
function gatheringIn(text: string): Gathering | null {
  if (LONG_EVENING.test(text)) return "long-evening";
  if (RECEPTION.test(text)) return "reception";
  return null;
}

/**
 * The most recent statement of how many people are drinking, anywhere in the person's own messages ("we are 8",
 * "for 12 people", "met z'n achten", "8 gasten", "we zijn met 6", number words EN/NL). Null when none; never a guess
 * ("a few friends" is not a number; "2015" or "3 bottles" is not a guest count). 1–500. Children are not counted:
 * they do not drink wine ("a party of 10 kids" is none, "8 adults and 4 kids" is 8).
 *
 * "Just me", "alleen ik" said in a later message than the number (or later in the same one) ends it: null, not 1.
 * One person needs no box of bottles, and an earlier evening's guests are not tonight's.
 *
 * The gathering is the most recent one said in that message or a later one of the person's; otherwise a dinner.
 */
export function guestsIn(messages: readonly ChatMessage[]): GuestCount | null {
  const own = messages
    .filter((m) => m.role === "user")
    .map((m) => normalizeText(m.text.slice(0, 800)));
  for (let i = own.length - 1; i >= 0; i--) {
    const count = lastCountIn(own[i]!);
    // "Just me", said last: one person is not a gathering, and the earlier number no longer holds.
    const solo = lastSoloIn(own[i]!);
    if (solo >= 0 && (!count || solo > count.at)) return null;
    if (!count) continue;
    let gathering: Gathering = "dinner";
    for (let j = own.length - 1; j >= i; j--) {
      const said = gatheringIn(own[j]!);
      if (said) {
        gathering = said;
        break;
      }
    }
    return { guests: count.guests, gathering };
  }
  return null;
}

// ---- The advice ----------------------------------------------------------------------------------------------

/** At most this many wines are counted in one advice (a menu has at most eight courses). */
export const QUANTITY_WINES_MAX = 8;

export interface QuantityAdvice {
  guests: number;
  gathering: Gathering;
  /** Bottles needed in all. */
  needed: number;
  /**
   * Per wine: needed, free to open (count minus reserved), short. `sequence`: poured one after another (a menu);
   * `alternatives`: any ONE of the cards is poured, so each line is the whole need against that wine.
   */
  mode: "alternatives" | "sequence";
  wines: Array<{ vintageId: string; needed: number; available: number; short: number }>;
  /**
   * True when `needed` is more than the estimate per person (`guests` × the gathering's share, rounded up) because
   * every wine poured is a whole bottle: few people, several wines. The screen then says so ("one bottle of each
   * wine; there will be wine left") instead of calling the total an estimate per person. Absent: false (advice kept
   * before this field existed, and every advice where the estimate per person is the total).
   */
  minimum?: boolean | undefined;
}

const bottles = z.number().int().min(0).max(100_000);
export const QuantityAdviceSchema: z.ZodType<QuantityAdvice> = z.object({
  guests: z.number().int().min(GUESTS_MIN).max(GUESTS_MAX),
  gathering: z.enum(GATHERINGS),
  needed: z.number().int().min(0).max(2_000),
  mode: z.enum(["alternatives", "sequence"]),
  wines: z
    .array(
      z.object({
        vintageId: z.string().min(1).max(64),
        needed: z.number().int().min(0).max(2_000),
        available: bottles,
        short: z.number().int().min(0).max(2_000),
      }),
    )
    .max(QUANTITY_WINES_MAX),
  minimum: z.boolean().optional(),
});

/** A whole, non-negative number of bottles; anything else is none. */
const whole = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/** Dessert and fortified wines are poured small: about half a share of a menu's wine. */
export const smallPour = (type: WineType): boolean => type === "dessert" || type === "fortified";

/** Rounding up that a float's last digit cannot tip over (2.0000000001 is 2). */
const up = (n: number) => Math.ceil(n - 1e-9);

/**
 * Bottles needed for the guests, against what is free to open of each wine. Reserved bottles are never counted as
 * available. Guests outside 1–500 are brought within (the advice says the number it used). At most eight pours.
 *
 * `sequence` (a menu): the evening's wine (guests × the gathering's share) is split over the pours, a small pour
 * (dessert, fortified) counting half. A wine poured with two courses is ONE line: its shares are added before it is
 * rounded up to whole bottles, so two courses of the same wine for two people are one bottle, not two. Every wine
 * poured is at least one bottle; when that, and not the estimate per person, makes the total, `minimum` says so.
 * `alternatives`: whichever one card is poured carries the whole evening; each line is that need.
 */
export function quantityFor(
  g: GuestCount,
  pours: ReadonlyArray<{ vintageId: string; count: number; reserved: number; small?: boolean }>,
  mode: "alternatives" | "sequence",
): QuantityAdvice {
  const guests = Number.isFinite(g.guests)
    ? Math.max(GUESTS_MIN, Math.min(GUESTS_MAX, Math.round(g.guests)))
    : GUESTS_MIN;
  const gathering: Gathering = GATHERINGS.includes(g.gathering) ? g.gathering : "dinner";
  const poured = pours.slice(0, QUANTITY_WINES_MAX);
  const free = (p: (typeof poured)[number]) => {
    const count = whole(p.count);
    return count - Math.min(count, whole(p.reserved));
  };
  // The estimate per person, as one number: what the evening needs if it were all one wine.
  const evening = guests * BOTTLES_PER_PERSON[gathering];
  const estimate = bottlesFor(guests, { gathering }).bottles;

  // One line per wine, in the order it is first poured, with its shares added up.
  const lines: Array<QuantityAdvice["wines"][number] & { share: number }> = [];
  for (const p of poured) {
    const share = p.small ? 0.5 : 1;
    const known = lines.find((l) => l.vintageId === p.vintageId);
    if (known) known.share += mode === "sequence" ? share : 0;
    else lines.push({ vintageId: p.vintageId, needed: 0, available: free(p), short: 0, share });
  }
  const shares = lines.reduce((sum, l) => sum + l.share, 0);
  for (const line of lines) {
    line.needed = mode === "sequence" ? Math.max(1, up((evening * line.share) / shares)) : estimate;
    line.short = enoughFor(line.needed, line.available).short;
  }
  const needed =
    mode === "sequence" && lines.length > 0
      ? lines.reduce((sum, l) => sum + l.needed, 0)
      : estimate;
  const wines = lines.map(({ vintageId, needed: n, available, short }) => ({
    vintageId,
    needed: n,
    available,
    short,
  }));
  return {
    guests,
    gathering,
    needed,
    mode,
    wines,
    ...(needed > estimate ? { minimum: true } : {}),
  };
}

const GATHERING_TEXT: Record<Gathering, string> = {
  dinner: "a dinner",
  reception: "a reception",
  "long-evening": "a long evening",
};

/** For the model: how many people, and that the app shows the number of bottles (it must not state its own). */
export function guestsBlock(g: GuestCount): string {
  return [
    "Guests (read by the app from what the person said; the app works out the bottles):",
    `- ${g.guests} ${g.guests === 1 ? "person" : "people"}, ${GATHERING_TEXT[g.gathering] ?? GATHERING_TEXT.dinner}.`,
    "- The app shows under your wines how many bottles are needed and how many of each are free to open. Do not state a number of bottles yourself; choose wines as usual and you may say the app has counted them.",
  ].join("\n");
}
