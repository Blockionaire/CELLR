import { normalizeText, type WineType } from "../cellar";
import { TASTE_SCALES, type TasteScale, type WineFocus } from "../taste";
import type { WineReading } from "./wine";

/**
 * HOW MUCH SOMEONE IS LIKELY TO LIKE A WINE, from -1 to 1, for ordering wines that already suit the dish. Built
 * only from what the taste profile supports: what the person said they like, and what their own ratings show.
 * Closed words and numbers go in (a colour, a scale, a known wine key); no free text, no wine names.
 *
 * The same shape serves the person asking and a friend who allowed their taste to be used, so a friend's taste
 * can never carry more than this into an answer.
 */
export interface TasteSignals {
  focus: WineFocus | null;
  /** What they said they like, 1–5 per scale. */
  said: Partial<Record<TasteScale, number>>;
  /** What their highly rated wines have in common, 1–5 per scale. */
  trends: Partial<Record<TasteScale, number>>;
  /** Colours their ratings favour. */
  styles: readonly WineType[];
  /** Regions and grapes their ratings favour, as the engine's wine keys ("bordeaux", "riesling"). */
  likes: readonly string[];
}

export const NO_TASTE: TasteSignals = Object.freeze({
  focus: null,
  said: {},
  trends: {},
  styles: [],
  likes: [],
});

export const hasTaste = (t: TasteSignals | null): t is TasteSignals =>
  t !== null &&
  (t.focus !== null ||
    t.styles.length > 0 ||
    t.likes.length > 0 ||
    Object.keys(t.said).length > 0 ||
    Object.keys(t.trends).length > 0);

/** The wine's structure on the taste profile's 1–5 scales. */
const onScale = (reading: Pick<WineReading, "structure">, scale: TasteScale): number => {
  const s = reading.structure;
  if (scale === "body") return s.body;
  if (scale === "acidity") return s.acidity;
  if (scale === "tannin") return 1 + (s.tannin * 4) / 5;
  return 1 + (s.sweetness * 4) / 5;
};

const onProfileScale = (n: number | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 5;

export function tasteScore(
  wine: Pick<WineReading, "structure" | "keys"> & { type: WineType },
  taste: TasteSignals | null,
): number {
  if (!hasTaste(taste)) return 0;
  let score = 0;
  if (taste.styles.includes(wine.type)) score += 0.35;
  const keys = new Set(wine.keys.map(normalizeText));
  if (taste.likes.some((k) => keys.has(normalizeText(k)))) score += 0.35;
  if (
    (taste.focus === "red" && wine.type === "red") ||
    (taste.focus === "white_rose" && (wine.type === "white" || wine.type === "rose"))
  )
    score += 0.15;
  else if (
    (taste.focus === "red" && (wine.type === "white" || wine.type === "rose")) ||
    (taste.focus === "white_rose" && wine.type === "red")
  )
    score -= 0.15;

  // How close the wine is to the scales they stated (these count double) and to what their ratings show.
  let distance = 0;
  let weight = 0;
  for (const scale of TASTE_SCALES) {
    const said = taste.said[scale];
    const trend = taste.trends[scale];
    const value = onScale(wine, scale);
    // Only a number on the profile's own scale counts; anything else is as good as not said.
    if (onProfileScale(said)) {
      distance += 2 * Math.abs(value - said);
      weight += 2;
    }
    if (onProfileScale(trend)) {
      distance += Math.abs(value - trend);
      weight += 1;
    }
  }
  // An average distance of 0 is +0.4, of 2 points or more is -0.4.
  if (weight > 0) score += 0.4 - Math.min(2, distance / weight) * 0.4;
  return Math.max(-1, Math.min(1, Math.round(score * 100) / 100));
}

/**
 * One score for several people at a table: the average, pulled toward the person who likes the wine least, so a
 * wine one guest would dislike does not win on the others' enthusiasm.
 */
export function groupTasteScore(scores: readonly number[]): number {
  if (scores.length === 0) return 0;
  const average = scores.reduce((a, b) => a + b, 0) / scores.length;
  const least = Math.min(...scores);
  return Math.round((0.5 * average + 0.5 * least) * 100) / 100;
}
