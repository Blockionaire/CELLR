/**
 * THE CELLR SCORE: external ratings and CELLR community reviews combined, transparently
 * (docs/sprints/ratings/DESIGN.md §4).
 *
 * - External ratings: their mean, weight 1 per rating, at most EXTERNAL_WEIGHT_CAP effective ratings.
 * - CELLR reviews: weight CELLR_WEIGHT per unique review. A CELLR score (tastings.score, 1–10 in tenths of a star)
 *   is stars = score / 2.
 * - Counts shown are always the real counts, never the weighted ones; the two averages are shown next to the
 *   combined score.
 * Pure: no I/O, no dates, deterministic.
 */

export const EXTERNAL_WEIGHT_CAP = 50;
export const CELLR_WEIGHT = 5;

/** A CELLR score (1..10, tenths of a star allowed: multiples of 0.2) in stars (0.5..5). */
export function cellrScoreToStars(score: number): number {
  if (!Number.isFinite(score) || score < 1 || score > 10) throw new Error("a CELLR score is 1..10");
  return Math.round((score / 2) * 100) / 100;
}

export interface ExternalRatings {
  /** Real number of ratings. */
  count: number;
  /** Sum in half stars (a 4.5-star rating adds 9), exact. */
  sumHalf: number;
}

export interface RatingScore {
  /** The combined CELLR score in stars, one decimal; null with no ratings at all. */
  combined: number | null;
  external: { count: number; average: number | null };
  cellr: { count: number; average: number | null };
  /** The effective weights behind `combined`, for the methodology page; never shown as counts. */
  weights: { external: number; cellr: number };
}

const one = (x: number) => Math.round(x * 10) / 10;

/** Pools external units (e.g. every vintage of one wine) into one: counts and sums add exactly. */
export function poolExternal(units: readonly ExternalRatings[]): ExternalRatings {
  return units.reduce((a, u) => ({ count: a.count + u.count, sumHalf: a.sumHalf + u.sumHalf }), {
    count: 0,
    sumHalf: 0,
  });
}

/**
 * The CELLR score from the external ratings (pooled for the selected vintage or vintages) and the CELLR scores
 * (1..10) of the unique published reviews in the same selection.
 */
export function ratingScore(
  external: ExternalRatings,
  cellrScores: readonly number[],
): RatingScore {
  if (!Number.isInteger(external.count) || external.count < 0)
    throw new Error("bad external count");
  if (
    external.count > 0 &&
    (external.sumHalf < external.count || external.sumHalf > 10 * external.count)
  )
    throw new Error("bad external sum");
  const extAvg = external.count > 0 ? external.sumHalf / 2 / external.count : null;
  const stars = cellrScores.map(cellrScoreToStars);
  const cellrAvg = stars.length > 0 ? stars.reduce((a, b) => a + b, 0) / stars.length : null;
  const wExt = Math.min(external.count, EXTERNAL_WEIGHT_CAP);
  const wCellr = CELLR_WEIGHT * stars.length;
  const total = wExt + wCellr;
  const combined =
    total === 0
      ? null
      : one(((extAvg ?? 0) * wExt + stars.reduce((a, b) => a + b, 0) * CELLR_WEIGHT) / total);
  return {
    combined,
    external: {
      count: external.count,
      average: extAvg === null ? null : Math.round(extAvg * 100) / 100,
    },
    cellr: {
      count: stars.length,
      average: cellrAvg === null ? null : Math.round(cellrAvg * 100) / 100,
    },
    weights: { external: wExt, cellr: wCellr },
  };
}

/** Ten half-star buckets (0.5 … 5.0) folded to five whole-star rows for display (0.5 and 1.0 → 1 star, …). */
export function starRows(distribution: readonly number[]): number[] {
  if (distribution.length !== 10) throw new Error("a distribution has 10 half-star buckets");
  return [0, 1, 2, 3, 4].map((i) => distribution[2 * i]! + distribution[2 * i + 1]!);
}

/** A CELLR score (1..10) in its half-star bucket index (0..9), rounded down to the half star. */
export function cellrBucket(score: number): number {
  const half = Math.floor(cellrScoreToStars(score) * 2 + 1e-9);
  return Math.min(Math.max(half, 1), 10) - 1;
}
