import { normalizeText, type WineType } from "./cellar";
import { TASTE_SCALES, type TasteProfileView, type TasteScale, type WineFocus } from "./taste";

/**
 * THE SOMMELIER'S VIEW OF YOUR TASTE: a few lines, built in code from your own taste profile (Sprint C2), never
 * guessed. Three kinds of knowledge are kept apart:
 *  1. what you said yourself (your answers in the taste profile);
 *  2. patterns your ratings support, only where the taste profile's own minimums are met (a favourite needs at
 *     least three different rated wines; a trend at least three highly rated wines with a reliable profile);
 *  3. everything else is unknown, and left out.
 * What you own or how often you drink something is never a preference: only answers and ratings count.
 */

export interface TasteContext {
  said: {
    focus: WineFocus | null;
    scales: Partial<Record<TasteScale, number>>;
  };
  rated: {
    /** Different wines with a score: the evidence behind the patterns. */
    wines: number;
    styles: Array<{ key: WineType; wines: number; average: number }>;
    regions: Array<{ key: string; wines: number; average: number }>;
    grapes: Array<{ key: string; wines: number; average: number }>;
    trends: Partial<Record<TasteScale, number>>;
  };
}

/** At most this many of each kind of pattern: enough to steer, short enough to stay cheap. */
const TOP = 2;

/** Null when there is nothing to go on: then the sommelier is simply the general one. */
export function tasteContextFrom(view: TasteProfileView | null): TasteContext | null {
  if (!view) return null;
  const p = view.preferences;
  const scales: TasteContext["said"]["scales"] = {};
  for (const s of TASTE_SCALES) {
    const v = p[s];
    if (typeof v === "number") scales[s] = v;
  }
  const o = view.overview;
  const trends: TasteContext["rated"]["trends"] = {};
  for (const s of TASTE_SCALES) {
    const t = o.trends[s];
    if (t) trends[s] = t.value;
  }
  const pick = <K extends string>(list: Array<{ key: K; wines: number; average: number }>) =>
    list.slice(0, TOP).map(({ key, wines, average }) => ({ key, wines, average }));
  const ctx: TasteContext = {
    said: { focus: p.wineFocus, scales },
    rated: {
      wines: o.winesRated,
      styles: pick(o.favouriteStyles.map((f) => ({ ...f, key: f.key as WineType }))),
      regions: pick(o.favouriteRegions),
      grapes: pick(o.favouriteGrapes),
      trends,
    },
  };
  const anything =
    ctx.said.focus !== null ||
    Object.keys(ctx.said.scales).length > 0 ||
    ctx.rated.styles.length + ctx.rated.regions.length + ctx.rated.grapes.length > 0 ||
    Object.keys(ctx.rated.trends).length > 0;
  return anything ? ctx : null;
}

const FOCUS_TEXT: Record<WineFocus, string> = {
  red: "mostly red",
  white_rose: "mostly white and rosé",
  both: "red and white alike",
};

/**
 * The few lines the model is shown (under ~500 characters): what was said, what ratings show and on how many
 * wines. The rules for using it are in the system prompt, so this stays data.
 */
export function tasteContextText(ctx: TasteContext, options: { explore?: boolean } = {}): string {
  const scale = (m: Partial<Record<TasteScale, number>>) =>
    TASTE_SCALES.flatMap((s) => (m[s] === undefined ? [] : [`${s} ${m[s]}/5`]));
  const said = [...(ctx.said.focus ? [FOCUS_TEXT[ctx.said.focus]] : []), ...scale(ctx.said.scales)];
  const fav = (list: Array<{ key: string; wines: number; average: number }>) =>
    list.map((f) => `${f.key.slice(0, 40)} (${f.wines} wines, ${f.average}★)`).join(", ");
  const rated = [
    ...(ctx.rated.styles.length ? [`styles ${fav(ctx.rated.styles)}`] : []),
    ...(ctx.rated.regions.length ? [`regions ${fav(ctx.rated.regions)}`] : []),
    ...(ctx.rated.grapes.length ? [`grapes ${fav(ctx.rated.grapes)}`] : []),
    ...(Object.keys(ctx.rated.trends).length
      ? [`liked wines lean ${scale(ctx.rated.trends).join(", ")}`]
      : []),
  ];
  const lines = [
    `Taste of the person asking${options.explore ? " (they ask for something different from it now)" : ""}:`,
    `- Said themselves: ${said.length ? said.join(", ") : "nothing"}.`,
    `- From their ratings (${ctx.rated.wines} wines rated): ${rated.length ? rated.join("; ") : "no clear pattern yet"}.`,
  ];
  return lines.join("\n").slice(0, 600);
}

/** "Something different": the person wants to step outside their usual taste (English and Dutch). */
const EXPLORE_WORDS = [
  "something different",
  "something new",
  "something else",
  "surprise me",
  "not my usual",
  "out of my comfort",
  "try something",
  "explore",
  "iets anders",
  "iets nieuws",
  "verras me",
  "eens wat anders",
  "buiten mijn",
  "ontdekken",
  "niet mijn gebruikelijke",
];
export const wantsSomethingDifferent = (question: string): boolean => {
  const q = ` ${normalizeText(question)} `;
  return EXPLORE_WORDS.some((w) => q.includes(normalizeText(w)));
};

/** A wine as far as a taste bonus needs to know it. */
export interface TasteCandidate {
  type: WineType;
  region: string | null;
}

/** The most a taste can move a wine in the Tonight ranking: below the gap between "ready" and "developing". */
export const MAX_TASTE_BONUS = 5;

/**
 * A small, deterministic nudge between otherwise similar wines: a kind of wine or region the person's ratings
 * show they love (+3 each), or the kind they said they drink most (+2). Never more than MAX_TASTE_BONUS, so it
 * cannot lift a poor pairing over a good one or a young wine over a ready one.
 */
export function tasteBonus(c: TasteCandidate, ctx: TasteContext | null): number {
  if (!ctx) return 0;
  let bonus = 0;
  if (ctx.rated.styles.some((s) => s.key === c.type)) bonus += 3;
  const region = c.region ? normalizeText(c.region) : null;
  if (region && ctx.rated.regions.some((r) => normalizeText(r.key) === region)) bonus += 3;
  const focus = ctx.said.focus;
  if (
    (focus === "red" && c.type === "red") ||
    (focus === "white_rose" && (c.type === "white" || c.type === "rose"))
  )
    bonus += 2;
  return Math.min(MAX_TASTE_BONUS, bonus);
}
