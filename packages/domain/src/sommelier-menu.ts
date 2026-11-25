import { z } from "zod";
import { normalizeText, type CellarItem } from "./cellar";
import { isCellarQuestion } from "./cellar-facts";
import { toSommelierBottle, type CellarDigest, type SommelierBottle } from "./sommelier";

/**
 * A MENU, AND A CHOICE BETWEEN TWO (Sommelier V1+, part `menu`). V1's model chooses the wine for each course of a
 * menu, in the one call it already makes; this module checks what it chose. Every wine it names for a course is
 * looked up in the list it was shown, so a made-up or mistyped reference gives that course no wine, never a card.
 * It also tells when a question asks to choose between two wines of the cellar ("the Barolo or the Chablis with the
 * lamb?"), so both can be put in front of the model.
 *
 * Pure, no knowledge: the screen's types live here. Reading the menu itself needs the food knowledge and is done
 * on the server (food/menu-context.ts).
 *
 * Known limits, on purpose (precision over reach):
 * - A course's reason (`why`) is the model's words, tidied and cut. A `[[ref]]` in it is shown as the wine's own
 *   name; a reference that is not on the list, an amount of money or a shop claim removes the reason (the wine
 *   stays, because it was checked). Other claims in it are not checked here.
 * - `compareRequest` only sees names as the cellar has them (producer, wine, appellation, or a distinctive stretch
 *   of the producer's or the wine's name), whole words, accents and case ignored. A nickname, a misspelling, a
 *   plural ("Barolos") or a wine named only by its grape is not found; a name two wines share ("the Barolo" with two
 *   Barolos) needs its year; and nothing is found when a third cellar wine is named in the same question. An "or" must stand
 *   between the two names (at most three words from each); "compare", "difference" or "better" also lets "and" or
 *   "with" do it. A question about the cellar itself ("do I have the Barolo or the Chablis?") is never a choice.
 */

// ---- What the screen draws -------------------------------------------------------------------------------------

/** The most courses planned (the same bound as the menu reader's, food/parse.ts `MAX_COURSES`). */
export const MENU_MAX_COURSES = 8;
export const MENU_SAID_MAX = 80;
export const MENU_WHY_MAX = 240;

export interface MenuAdvice {
  courses: Array<{
    /** The course as the person said it (≤ 80 chars, tidied). */
    said: string;
    /** V1's wine for it; null: nothing in the cellar suits, or the model named none. */
    vintageId: string | null;
    /** V1's short reason (≤ 240 chars, tidied); null when none. */
    why: string | null;
    /** The same wine is poured with another course too. */
    shared: boolean;
    /**
     * No wine could be chosen for this course: the model named a wine that is not on the list, or gave this course
     * no entry. Absent (also in answers kept before it existed): the model chose the wine, or said that nothing in
     * the cellar suits (vintageId null).
     */
    unchosen?: true | undefined;
  }>;
  /** More courses were said than are planned (MAX_COURSES). */
  cut: boolean;
}

/** A kept answer's menu: bounded, so a stored value that does not fit is left out rather than drawn. */
export const MenuAdviceSchema: z.ZodType<MenuAdvice> = z.object({
  courses: z
    .array(
      z.object({
        said: z.string().max(MENU_SAID_MAX),
        vintageId: z.string().min(1).max(64).nullable(),
        why: z.string().min(1).max(MENU_WHY_MAX).nullable(),
        shared: z.boolean(),
        unchosen: z.literal(true).optional(),
      }),
    )
    .min(1)
    .max(MENU_MAX_COURSES),
  cut: z.boolean(),
});

// ---- Checking what the model chose -----------------------------------------------------------------------------

/** How many course entries of the model are read at all (more is noise: the menu has at most eight courses). */
const MAX_RAW = 64;

const tidy = (value: string, max: number) => {
  const flat = value
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= max) return flat;
  // Cut at a word, with an ellipsis, so a cut reason does not end in half a word.
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trim()}…`;
};

/** Money, a shop or a stock claim: never shown as a reason (no price or availability is known to the app). */
const UNPROVEN =
  /[€$£]|\b(?:eur|euro|euros|dollars?|pounds?|cents?)\b|\b\d+[.,]\d{2}\b|\b(?:in stock|available at|on sale|verkrijgbaar|op voorraad|te koop bij|in de aanbieding)\b/i;

/** What a ref looks like (the digest's short names are hex, or a whole id): only such a bracketed word is one. */
const REF_LIKE =
  /^(?:[0-9a-f]{6,36}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * The model's reason for a course, as the screen may show it. Every form a ref takes is written as the wine's
 * name first ("[[a1b2c3]]", "[a1b2c3]", or the bare ref), and only then is the text tidied and cut, so nothing
 * done afterwards can make it longer than MENU_WHY_MAX. Null when there is none, when a bracketed ref is not on the
 * list (the reason was about a wine that is not there), or when it names a price or a shop.
 */
function reasonOf(why: string, digest: CellarDigest): string | null {
  const lookup = (ref: string) =>
    digest.refs.get(ref) ?? digest.refs.get(ref.toLowerCase()) ?? null;
  let unknown = false;
  const named = why
    .slice(0, 2000)
    .replace(
      /\[\[\s*([^\]\s]{1,40})\s*\]\]|\[\s*([^\][\s]{1,40})\s*\]|\b([0-9A-Za-z][0-9A-Za-z-]{4,35})\b/g,
      (whole: string, double?: string, single?: string, bare?: string) => {
        const ref = double ?? single ?? bare ?? "";
        const item = lookup(ref);
        if (item) return nameOf(item);
        // "[[x]]" always meant a wine; "[a1b2c3]" did when it looks like a ref. Other words are words.
        if (double !== undefined || (single !== undefined && REF_LIKE.test(single))) unknown = true;
        return whole;
      },
    );
  if (unknown || UNPROVEN.test(named)) return null;
  const text = tidy(named, MENU_WHY_MAX);
  return text === "" ? null : text;
}

/** A wine's name as the screen says it: producer, wine and year, the producer once ("Château d'Yquem 2009"). */
const nameOf = (i: CellarItem) => {
  const wine = normalizeText(i.wineName).startsWith(normalizeText(i.producer))
    ? i.wineName
    : `${i.producer} ${i.wineName}`;
  return `${wine}${i.year === null ? "" : ` ${i.year}`}`;
};

/**
 * What the model returned per course, checked: a ref that is not in the digest gives no wine (never a card). One
 * entry per course of the menu, in its order, whatever the model sent: a course it left out, numbered twice (the
 * first counts) or out of range has no wine of its own. `bottles`: the distinct wines, in course order.
 */
export function checkMenuAnswer(
  raw: ReadonlyArray<{ course: number; ref: string | null; why: string }>,
  courses: ReadonlyArray<{ said: string }>,
  cut: boolean,
  digest: CellarDigest,
): { menu: MenuAdvice; bottles: SommelierBottle[] } {
  const planned = courses.slice(0, MENU_MAX_COURSES);
  const byCourse = new Map<number, { ref: string | null; why: string }>();
  for (const entry of raw.slice(0, MAX_RAW)) {
    const n = entry.course;
    if (!Number.isInteger(n) || n < 1 || n > planned.length || byCourse.has(n)) continue;
    byCourse.set(n, entry);
  }
  const chosen = planned.map((course, i) => {
    const entry = byCourse.get(i + 1);
    const ref = typeof entry?.ref === "string" ? entry.ref.trim() : "";
    const item = ref === "" ? null : (digest.refs.get(ref) ?? null);
    // A wine that is not on the list: no wine, and no reason either (the reason was about that wine).
    const invented = ref !== "" && item === null;
    const why =
      entry && !invented && typeof entry.why === "string" ? reasonOf(entry.why, digest) : null;
    // Not "nothing suits": nobody said that. The screen says that no wine could be chosen.
    const unchosen = entry === undefined || invented;
    return { said: tidy(course.said, MENU_SAID_MAX), item, why, unchosen };
  });
  const poured = new Map<string, number>();
  for (const c of chosen)
    if (c.item) poured.set(c.item.vintageId, (poured.get(c.item.vintageId) ?? 0) + 1);
  const bottles: SommelierBottle[] = [];
  const seen = new Set<string>();
  for (const c of chosen)
    if (c.item && !seen.has(c.item.vintageId)) {
      seen.add(c.item.vintageId);
      bottles.push(toSommelierBottle(c.item));
    }
  return {
    menu: {
      courses: chosen.map((c) => ({
        said: c.said,
        vintageId: c.item?.vintageId ?? null,
        why: c.why,
        shared: c.item !== null && (poured.get(c.item.vintageId) ?? 0) > 1,
        ...(c.unchosen ? { unchosen: true as const } : {}),
      })),
      cut: cut || courses.length > MENU_MAX_COURSES,
    },
    bottles,
  };
}

/**
 * The cards for a choice between two wines: exactly those two, the one the model chose (its first ref of the
 * two) first. When it pointed at neither, the order the question named them in.
 */
export function comparedBottles(
  refs: readonly string[],
  vintageIds: readonly [string, string],
  items: readonly CellarItem[],
  digest: CellarDigest,
): SommelierBottle[] {
  const byId = new Map(items.map((i) => [i.vintageId, i]));
  const firstChosen = refs
    .map((r) => digest.refs.get(r.trim())?.vintageId)
    .find((id) => id === vintageIds[0] || id === vintageIds[1]);
  const order = firstChosen === vintageIds[1] ? [vintageIds[1], vintageIds[0]] : [...vintageIds];
  return order.flatMap((id) => {
    const item = byId.get(id);
    return item ? [toSommelierBottle(item)] : [];
  });
}

/**
 * The two cards for a choice between two wines, the one the model would open first, but ONLY when the model
 * pointed at one of the two (its `bottle_refs`). Null otherwise: then V1's own cards stand, so the pair never
 * overrides what the model chose (it may have found both wrong and chosen a third).
 */
export function comparedCards(
  refs: readonly string[],
  vintageIds: readonly [string, string],
  items: readonly CellarItem[],
  digest: CellarDigest,
): SommelierBottle[] | null {
  const pointed = refs.some((r) => {
    const id = digest.refs.get(r.trim())?.vintageId;
    return id === vintageIds[0] || id === vintageIds[1];
  });
  if (!pointed) return null;
  const cards = comparedBottles(refs, vintageIds, items, digest);
  return cards.length === 2 ? cards : null;
}

/** A little more room to answer for a menu: about seventy tokens a course, never more than 600 extra. */
export const menuMaxOutputTokens = (base: number, courses: number): number =>
  base + Math.min(600, 70 * Math.max(0, Math.min(courses, MENU_MAX_COURSES)));

// ---- A choice between two wines --------------------------------------------------------------------------------

/** Words that set two things side by side: "the Barolo or the Chablis", "Rioja of Chianti", "X vs Y". */
const CHOICE = new Set(["or", "of", "vs", "versus"]);
/** With a word of comparing in the question, these do it too: "compare the Barolo and the Chablis". */
const ALSO_WHEN_COMPARING = new Set([
  "and",
  "en",
  "with",
  "met",
  "to",
  "than",
  "dan",
  "against",
  "tegen",
  "tegenover",
]);
const COMPARING =
  /\b(?:compare|comparing|comparison|vergelijk\w*|difference|differences|verschil\w*|better|beter|which of|welke van)\b/i;
/** How many words may stand between a name and the "or" ("the Barolo 2016 or my Chablis"). */
const GAP = 3;
/** Marks where a sentence ended: nothing is read across it. Not a word any name contains. */
const STOP = "|";
const YEAR = /^(?:1[89]|20)\d\d$/;
/** Words that are a colour, a style or a title, not a name ("Rouge", "Brut", "Château"). */
const GENERIC = new Set(
  normalizeText(
    "red white rose rouge blanc rood wit rosso bianco rosato tinto blanco brut extra sec demi reserve reserva riserva " +
      "gran grand cru premier classico superiore cuvee wine wines vin vino wein wijn domaine chateau castello " +
      "weingut bodega bodegas tenuta cantina maison quinta cave caves estate winery cellars vineyards vineyard " +
      "vieilles vignes vigne old vine vines selection family single special speciale prestige tradition classic " +
      "nature dulce dolce doux sweet dry year years aged the and with",
  ).split(" "),
);
/** Each plain letter and the accented letters that fold to it (for the quick look at a wine's names). */
const ACCENTED: Record<string, string> = {
  a: "[aàáâãäå]",
  c: "[cç]",
  e: "[eèéêë]",
  i: "[iìíîï]",
  n: "[nñ]",
  o: "[oòóôõöø]",
  u: "[uùúûü]",
  y: "[yýÿ]",
};

/**
 * Whether a stretch of a wine's name, as the question says it, names the wine: it holds a distinctive word ("Vajra"
 * of "G.D. Vajra", "Chianti" of "Chianti Classico", "Montée de Tonnerre"), or a number with another word ("Cuvée
 * 1522", "Les 7"). A stretch of only colours, styles, titles and short words is not a name ("Rouge", "Château").
 */
const isName = (words: readonly string[]) =>
  words.join(" ").length >= 4 &&
  words.some(
    (w) =>
      (w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w)) ||
      (words.length >= 2 && /^\d+$/.test(w) && !YEAR.test(w)),
  );

/**
 * normalizeText, without most of its Unicode work: plain ASCII, and Latin letters with accents ("Cuvée",
 * "Montée"), give the same words for much less. Anything else goes through normalizeText itself.
 */
const fold = (text: string) => {
  const ascii = /^[\x20-\x7e]*$/.test(text)
    ? text
    : text.normalize("NFKD").replace(/[\u0300-\u036f]+/g, "");
  if (!/^[\x20-\x7e]*$/.test(ascii)) return normalizeText(text);
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

interface Mention {
  start: number;
  /** Exclusive. */
  end: number;
  items: CellarItem[];
}

/** A sentence that asks: it ends in "?", or opens as a question. */
const ASKS =
  /^(?:which|what|should|shall|would|could|can|do|does|is|are|will|or|welke|welk|wat|zal|zullen|moet|moeten|kan|kun|kunnen|zou|past|passen|is|zijn|wordt)\b/;
/**
 * A clause that says something about the person rather than asking ("I love Sassicaia or Barolo", "we hebben
 * Rioja of Chianti"): an "or" in it is not a choice put to the sommelier.
 */
const STATES =
  /^(?:but |maar |and |en |so |dus )?(?:i|we|ik|wij|my|mijn|our|onze)(?: really| usually| always| echt| meestal| altijd)? (?:love|like|adore|prefer|enjoy|have|had|got|bought|drank|drink|collect|keep|hou|houd|vind|heb|hebben|had|hadden|kocht|kochten|dronk|dronken|drinken|verzamel|bewaar)\b/;

/**
 * "The Barolo or the Chablis with the lamb?" or "the 2015 or the 2018 Barolo?" (in Dutch: "Rioja of Chianti bij de
 * pizza"): two (exactly two) cellar wines the question names, when it asks to choose between them. The choice must
 * be the question itself: an "or" in a statement ("I love Sassicaia or Barolo, but tonight …. What should I open?")
 * is not one. Null when it is not such a question, or names fewer or more than two, or cannot tell which vintage
 * is meant. Names are looked up through an index of the words the question holds, so a large cellar stays fast.
 */
export function compareRequest(
  question: string,
  items: readonly CellarItem[],
): { vintageIds: [string, string] } | null {
  if (items.length < 1 || isCellarQuestion(question)) return null;
  // Sentence by sentence (nothing is read across a STOP), each word knowing whether its clause may hold the choice.
  const sentences = question
    .slice(0, 800)
    .split(/(?<=[.?!;\n])/)
    .map((raw) => ({ raw, words: normalizeText(raw) }))
    .filter((x) => x.words !== "");
  const asks = sentences.map((x) => /\?\s*$/.test(x.raw) || ASKS.test(x.words));
  // With no sentence that asks ("Barolo or Chablis with the lamb"), the message itself is the question.
  const anyAsks = asks.some(Boolean);
  const tokens: string[] = [];
  /** Whether an "or" at this word may be the choice. */
  const choosable: boolean[] = [];
  sentences.forEach((sentence, n) => {
    if (tokens.length > 0) {
      tokens.push(STOP);
      choosable.push(false);
    }
    for (const clause of sentence.raw.split(/,|\bbut\b|\bmaar\b/i)) {
      const words = normalizeText(clause);
      if (words === "") continue;
      const may = (asks[n]! || !anyAsks) && !STATES.test(words);
      for (const w of words.split(" ")) {
        tokens.push(w);
        choosable.push(may);
      }
    }
  });
  // Where each word of the question stands, so each wine is looked up by its own words, not the other way round.
  const positions = new Map<string, number[]>();
  tokens.forEach((t, i) => {
    if (t === STOP) return;
    const list = positions.get(t);
    if (list) list.push(i);
    else positions.set(t, [i]);
  });
  // Every place a stretch of a wine's name stands in the question, as long as it goes ("Vajra Barolo" is one
  // wine, not every Barolo): the producer and the wine as one run of words, and the appellation.
  const at = new Map<string, Mention>();
  // A first, cheap look: does any word of the question stand in the wine's names at all? One pattern of the
  // question's words, tried on each wine's names (accents taken off first, the way the question's were).
  const asked = [...positions.keys()].filter((w) => /^[a-z0-9]+$/.test(w));
  const anyWord = new RegExp(`(?:^|[^a-z0-9])(?:${asked.join("|") || "(?!)"})(?:$|[^a-z0-9])`);
  // The same words with their accented letters allowed ("cuvee" finds "cuvée"), for names that have accents.
  const loose = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(?:${asked.map((w) => w.replace(/[aceinouy]/g, (ch) => ACCENTED[ch] ?? ch)).join("|") || "(?!)"})(?:$|[^\\p{L}\\p{N}])`,
    "u",
  );
  const mayBeNamed = (item: CellarItem) => {
    const text = `${item.producer} ${item.wineName} ${item.appellation ?? ""}`.toLowerCase();
    if (/^[\x20-\x7e]*$/.test(text)) return anyWord.test(text);
    if (loose.test(text)) return true;
    // Letters that fold to two ("æ", "ß") or another script: only read the slow way.
    return /[^\x20-\x7e\u00c0-\u00e5\u00e7-\u00f6\u00f8-\u00fd\u00ff]/.test(text);
  };
  for (const item of items) {
    if (!mayBeNamed(item)) continue;
    const sources = [fold(`${item.producer} ${item.wineName}`), fold(item.appellation ?? "")];
    for (const source of sources) {
      if (source === "") continue;
      const words = source.split(" ");
      for (let j = 0; j < words.length; j++)
        for (const i of positions.get(words[j]!) ?? []) {
          // Only from where a run starts: the same run seen from its second word is not another.
          if (j > 0 && i > 0 && tokens[i - 1] === words[j - 1]) continue;
          let length = 1;
          while (j + length < words.length && tokens[i + length] === words[j + length]) length++;
          if (!isName(words.slice(j, j + length))) continue;
          const key = `${i}:${i + length}`;
          const m = at.get(key);
          if (!m) at.set(key, { start: i, end: i + length, items: [item] });
          // Items are looked at one after the other: a repeat can only be the item just added.
          else if (m.items.at(-1) !== item) m.items.push(item);
        }
    }
  }
  const found = [...at.values()];
  const mentions = found.filter(
    (m) =>
      !found.some(
        (o) => o !== m && o.start <= m.start && o.end >= m.end && o.end - o.start > m.end - m.start,
      ),
  );
  const wines = new Set(mentions.flatMap((m) => m.items.map((i) => i.wineId)));
  if (wines.size === 0 || wines.size > 2) return null;
  const comparing = COMPARING.test(question);
  for (let c = 0; c < tokens.length; c++) {
    const word = tokens[c]!;
    if (!choosable[c]) continue;
    if (!CHOICE.has(word) && !(comparing && ALSO_WHEN_COMPARING.has(word))) continue;
    const left = sideOf(tokens, mentions, c, -1);
    const right = sideOf(tokens, mentions, c, 1);
    if (!left || !right) continue;
    // "The 2015 or the 2018 Barolo": a side with only a year is the same wine as the other side.
    const sameWine = (side: Side, other: Side) =>
      side.mention
        ? side.mention.items
        : other.mention
          ? allVintages(items, other.mention.items)
          : null;
    const leftItems =
      left.mention || right.mention
        ? sameWine(left, right)
        : wines.size === 1
          ? items.filter((i) => wines.has(i.wineId))
          : null;
    const rightItems = left.mention || right.mention ? sameWine(right, left) : leftItems;
    const a = leftItems ? pick(leftItems, left.years) : null;
    const b = rightItems ? pick(rightItems, right.years) : null;
    if (a && b && a.vintageId !== b.vintageId) return { vintageIds: [a.vintageId, b.vintageId] };
  }
  return null;
}

interface Side {
  mention: Mention | null;
  /** Years said on this side, near the name (null year: "NV"). */
  years: Array<number | null>;
}

/** What stands on one side of the "or": the nearest name within GAP words, and the years said with it. */
function sideOf(
  tokens: readonly string[],
  mentions: readonly Mention[],
  c: number,
  dir: -1 | 1,
): Side | null {
  const gapOf = (m: Mention) => (dir < 0 ? c - m.end : m.start - c - 1);
  const crosses = (from: number, to: number) =>
    tokens.slice(Math.min(from, to), Math.max(from, to) + 1).includes(STOP);
  const mention =
    mentions
      .filter((m) => (dir < 0 ? m.end <= c : m.start > c) && gapOf(m) >= 0 && gapOf(m) <= GAP)
      .filter((m) => !crosses(dir < 0 ? m.end : c, dir < 0 ? c : m.start))
      .sort((a, b) => gapOf(a) - gapOf(b) || b.end - b.start - (a.end - a.start))[0] ?? null;
  // Years near the name, or (with no name on this side) near the "or" itself.
  const from = dir < 0 ? (mention ? mention.start - 2 : c - GAP - 1) : c + 1;
  const to = dir < 0 ? c - 1 : mention ? mention.end + 1 : c + GAP + 1;
  const years: Array<number | null> = [];
  for (let i = Math.max(0, from); i <= Math.min(tokens.length - 1, to); i++) {
    if (crosses(i, c)) continue;
    const t = tokens[i]!;
    if (YEAR.test(t)) years.push(Number(t));
    else if (t === "nv") years.push(null);
  }
  if (!mention && years.length === 0) return null;
  return { mention, years };
}

/** Every vintage the cellar holds of the wines named. */
const allVintages = (items: readonly CellarItem[], named: readonly CellarItem[]) => {
  const ids = new Set(named.map((i) => i.wineId));
  return items.filter((i) => ids.has(i.wineId));
};

/** The one vintage meant: the only one there is, or the one whose year was said. Null when that is not clear. */
function pick(
  candidates: readonly CellarItem[],
  years: ReadonlyArray<number | null>,
): CellarItem | null {
  const fitting = years.length > 0 ? candidates.filter((i) => years.includes(i.year)) : candidates;
  return fitting.length === 1 ? fitting[0]! : null;
}
