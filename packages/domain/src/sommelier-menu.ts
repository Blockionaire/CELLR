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

/**
 * The model's reason for a course, as the screen may show it: tidied, cut, with every `[[ref]]` written as the
 * wine's name. Null when there is none, or when it points at a wine that is not on the list, or names a price or
 * a shop.
 */
function reasonOf(why: string, digest: CellarDigest): string | null {
  let unknown = false;
  const named = why.replace(/\[\[\s*([^\]\s]{1,40})\s*\]\]/g, (_, ref: string) => {
    const item = digest.refs.get(ref);
    if (!item) unknown = true;
    return item ? nameOf(item) : "";
  });
  if (unknown || UNPROVEN.test(named)) return null;
  const text = tidy(named, MENU_WHY_MAX);
  return text === "" ? null : text;
}

const nameOf = (i: CellarItem) =>
  `${i.producer} ${i.wineName}${i.year === null ? "" : ` ${i.year}`}`;

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
    return { said: tidy(course.said, MENU_SAID_MAX), item, why };
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
/** A producer's title, which a person often leaves out ("Musar" for "Château Musar"). */
const TITLE =
  /^(?:domaine|domaines|chateau|weingut|bodega|bodegas|tenuta|cantina|castello|maison|quinta|cave|caves|clos des)\s+/;

/** The longest name (in words) whose parts are tried as names of their own. */
const MAX_NAME_WORDS = 8;

/**
 * The names a person may call a wine by, as normalised words: the producer, the wine, both together, the
 * appellation, and every stretch of the producer's or the wine's name that holds a distinctive word ("Vajra" for
 * "G.D. Vajra", "Chianti" for "Chianti Classico", "Montée de Tonnerre"). A stretch of only colours, styles, titles
 * and short words is not a name.
 */
function namesOf(item: CellarItem): string[][] {
  const producer = normalizeText(item.producer);
  const wine = normalizeText(item.wineName);
  const names = new Set([`${producer} ${wine}`, normalizeText(item.appellation ?? "")]);
  for (const whole of [producer, producer.replace(TITLE, ""), wine]) {
    const words = whole.split(" ").slice(0, MAX_NAME_WORDS);
    for (let i = 0; i < words.length; i++)
      for (let j = i + 1; j <= words.length; j++) names.add(words.slice(i, j).join(" "));
  }
  return [...names]
    .filter(
      (n) =>
        n.length >= 4 &&
        !/^\d+$/.test(n) &&
        n.split(" ").some(
          (w, _, all) =>
            (w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w)) ||
            // "Cuvée 1522", "Les 7": a number makes a stretch of two words a name.
            (all.length >= 2 && /^\d+$/.test(w) && !YEAR.test(w)),
        ),
    )
    .map((n) => n.split(" "));
}

interface Mention {
  start: number;
  /** Exclusive. */
  end: number;
  items: CellarItem[];
}

/**
 * "The Barolo or the Chablis with the lamb?" or "the 2015 or the 2018 Barolo?" (in Dutch: "Rioja of Chianti bij de
 * pizza"): two (exactly two) cellar wines the question names, when it asks to choose between them. Null when it is not
 * such a question, or names fewer or more than two, or cannot tell which vintage is meant.
 */
export function compareRequest(
  question: string,
  items: readonly CellarItem[],
): { vintageIds: [string, string] } | null {
  if (items.length < 1 || isCellarQuestion(question)) return null;
  const tokens = question
    .slice(0, 800)
    .split(/[.?!;\n]+/)
    .map((clause) => normalizeText(clause))
    .filter(Boolean)
    .join(` ${STOP} `)
    .split(" ");
  // Every place a wine's name stands, longest names first: "Vajra Barolo" is one wine, not every Barolo.
  const found: Mention[] = [];
  for (const item of items)
    for (const name of namesOf(item))
      for (let i = 0; i + name.length <= tokens.length; i++)
        if (name.every((w, j) => tokens[i + j] === w)) {
          const at = found.find((m) => m.start === i && m.end === i + name.length);
          if (at) {
            if (!at.items.includes(item)) at.items.push(item);
          } else found.push({ start: i, end: i + name.length, items: [item] });
        }
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
