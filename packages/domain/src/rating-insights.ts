import type { WineType } from "./cellar";
import type { JournalEntry } from "./journal";
import { MIN_FAVOURITE_WINES, type Favourite, type TasteProfileView } from "./taste";

/**
 * RATINGS INSIGHTS: what my own ratings say, worked out deterministically from the taste profile (one point per
 * wine, favourites only with enough wines behind them) and my journal (for time). No AI, nothing stored.
 *
 * Honesty rules
 * - Every insight carries how many different wines support it; repeated bottles of one wine count once.
 * - Kinds of wine are compared only when at least two kinds each have MIN_COMPARE_WINES rated wines.
 * - "Drunk most" (frequency) and "rated highest" (preference) are never mixed up: the contrast is only shown when
 *   both sides are real (a favourite with enough wines, a most-tasted region) and they differ.
 * - A discovery is a real favourite (enough wines, high mean) that is still a small part of what I taste.
 * - Over time: only periods with MIN_PERIOD_WINES different rated wines, and only when there are two of them.
 */

export const MIN_COMPARE_WINES = MIN_FAVOURITE_WINES;
export const MIN_PERIOD_WINES = 3;
/** A favourite is a "discovery" while it is at most this share of the different wines I have tasted… */
export const DISCOVERY_MAX_SHARE = 0.25;
/** …and only once I have tasted enough wines for a share to mean something. */
export const DISCOVERY_MIN_WINES = 8;

export interface TypeInsight {
  type: WineType;
  /** Different rated wines of this kind. */
  wines: number;
  /** Mean over those wines, in stars, one decimal. */
  average: number;
}

export interface RatingInsights {
  /** Different wines I rated, and the mean over them (one per wine), in stars. */
  winesRated: number;
  average: number | null;
  /** Kinds of wine with enough rated wines to compare, best first; empty when fewer than two qualify. */
  byType: TypeInsight[];
  favouriteRegions: Favourite[];
  favouriteGrapes: Favourite[];
  /** What I drink most against what I rate highest, when they are different places. */
  oftenVsBest: { often: { key: string; wines: number }; best: Favourite } | null;
  /** A real favourite that is still a small part of what I taste. */
  discovery: { favourite: Favourite; kind: "region" | "grape" | "style"; share: number } | null;
  /** Mean per year (one point per wine within the year), oldest first; null when there is too little. */
  overTime: Array<{ year: number; wines: number; average: number }> | null;
}

const stars1 = (score: number) => Math.round((score / 2) * 10) / 10;
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Mean score (1..10) per wine among these entries: a wine rated three times is one point. */
function perWine(entries: readonly Pick<JournalEntry, "wineId" | "score">[]): number[] {
  const scores = new Map<string, number[]>();
  for (const e of entries) {
    if (e.score === null) continue;
    scores.set(e.wineId, [...(scores.get(e.wineId) ?? []), e.score]);
  }
  return [...scores.values()].map(mean);
}

export function ratingInsights(
  profile: Pick<TasteProfileView, "overview" | "distribution">,
  entries: readonly Pick<JournalEntry, "wineId" | "score" | "tastedAt">[],
): RatingInsights {
  const o = profile.overview;

  const byTypeAll = profile.distribution
    .filter((d) => d.rated >= MIN_COMPARE_WINES && d.average !== null)
    .map((d) => ({ type: d.type, wines: d.rated, average: d.average! }))
    .sort((a, b) => b.average - a.average || b.wines - a.wines);
  const byType = byTypeAll.length >= 2 ? byTypeAll : [];

  const bestRegion = o.favouriteRegions[0] ?? null;
  const oftenRegion = o.mostTastedRegions[0] ?? null;
  const oftenVsBest =
    bestRegion && oftenRegion && bestRegion.key !== oftenRegion.key
      ? { often: oftenRegion, best: bestRegion }
      : null;

  let discovery: RatingInsights["discovery"] = null;
  if (o.winesTasted >= DISCOVERY_MIN_WINES) {
    const candidates = [
      ...o.favouriteRegions.map((f) => ({ favourite: f, kind: "region" as const })),
      ...o.favouriteGrapes.map((f) => ({ favourite: f, kind: "grape" as const })),
      ...o.favouriteStyles.map((f) => ({ favourite: f, kind: "style" as const })),
    ]
      .map((c) => ({ ...c, share: c.favourite.wines / o.winesTasted }))
      .filter((c) => c.share <= DISCOVERY_MAX_SHARE)
      .sort((a, b) => b.favourite.average - a.favourite.average || a.share - b.share);
    discovery = candidates[0] ?? null;
  }

  const years = new Map<number, Pick<JournalEntry, "wineId" | "score">[]>();
  for (const e of entries) {
    if (e.score === null) continue;
    const y = Number(e.tastedAt.slice(0, 4));
    if (!Number.isFinite(y)) continue;
    years.set(y, [...(years.get(y) ?? []), e]);
  }
  const periods = [...years.entries()]
    .map(([year, list]) => ({ year, points: perWine(list) }))
    .filter((p) => p.points.length >= MIN_PERIOD_WINES)
    .sort((a, b) => a.year - b.year)
    .map((p) => ({ year: p.year, wines: p.points.length, average: stars1(mean(p.points)) }));

  return {
    winesRated: o.winesRated,
    average: o.average,
    byType,
    favouriteRegions: o.favouriteRegions.slice(0, 3),
    favouriteGrapes: o.favouriteGrapes.slice(0, 3),
    oftenVsBest,
    discovery,
    overTime: periods.length >= 2 ? periods : null,
  };
}
