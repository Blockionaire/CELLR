/**
 * THE CELLR SCORE: external ratings and CELLR community reviews combined, transparently
 * (docs/sprints/ratings/DESIGN.md §4).
 *
 * - External ratings: their mean, weight 1 per rating, at most `externalCap` effective ratings (default 50).
 * - CELLR reviews: weight `cellr` per unique review (default 5). A CELLR score (tastings.score, 1–10 in tenths of a
 *   star) is stars = score / 2.
 * - Counts shown are always the real counts, never the weighted ones; the two averages are shown next to the
 *   combined score.
 * The two weights are server configuration (CELLR_COMMUNITY_WEIGHT, CELLR_EXTERNAL_WEIGHT_CAP, read by
 * `parseRatingWeights`); the ones used travel with the ratings data, so the page shows the numbers it computed with.
 * Pure: no I/O, no dates, deterministic.
 */

/** The default cap on the external ratings' weight. */
export const EXTERNAL_WEIGHT_CAP = 50;
/** The default weight of one CELLR review. */
export const CELLR_WEIGHT = 5;

export interface RatingWeights {
  /** The weight of one CELLR review: an integer 1..20. */
  cellr: number;
  /** The most effective external ratings: an integer 10..500. */
  externalCap: number;
}

export const DEFAULT_RATING_WEIGHTS: Readonly<RatingWeights> = Object.freeze({
  cellr: CELLR_WEIGHT,
  externalCap: EXTERNAL_WEIGHT_CAP,
});
export const RATING_WEIGHT_LIMITS = {
  cellr: { min: 1, max: 20 },
  externalCap: { min: 10, max: 500 },
} as const;

const within = (n: unknown, l: { min: number; max: number }): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= l.min && n <= l.max;

/** The weights when both are in range, else the defaults (one bad value never makes a half-configured score). */
export function checkedRatingWeights(w: Partial<RatingWeights> | null | undefined): RatingWeights {
  return w &&
    within(w.cellr, RATING_WEIGHT_LIMITS.cellr) &&
    within(w.externalCap, RATING_WEIGHT_LIMITS.externalCap)
    ? { cellr: w.cellr, externalCap: w.externalCap }
    : { ...DEFAULT_RATING_WEIGHTS };
}

/**
 * The weights from configuration, fail-safe: each value must be a plain integer in its range ("7", not "7.5",
 * "0x7" or "7 times"); an unset or invalid value takes its default, on its own.
 */
export function parseRatingWeights(raw: {
  cellr?: string | undefined;
  externalCap?: string | undefined;
}): RatingWeights {
  const int = (v: string | undefined, l: { min: number; max: number }, fallback: number) => {
    const t = v?.trim() ?? "";
    if (!/^[0-9]{1,4}$/.test(t)) return fallback;
    const n = Number(t);
    return within(n, l) ? n : fallback;
  };
  return {
    cellr: int(raw.cellr, RATING_WEIGHT_LIMITS.cellr, CELLR_WEIGHT),
    externalCap: int(raw.externalCap, RATING_WEIGHT_LIMITS.externalCap, EXTERNAL_WEIGHT_CAP),
  };
}

/** How many CELLR reviews weigh at least as much as the full external weight (for the methodology text). */
export const communityParity = (w: RatingWeights): number => Math.ceil(w.externalCap / w.cellr);

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
 * (1..10) of the unique published reviews in the same selection, with the given weights (out-of-range: defaults).
 */
export function ratingScore(
  external: ExternalRatings,
  cellrScores: readonly number[],
  weights: RatingWeights = DEFAULT_RATING_WEIGHTS,
): RatingScore {
  const w = checkedRatingWeights(weights);
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
  const wExt = Math.min(external.count, w.externalCap);
  const wCellr = w.cellr * stars.length;
  const total = wExt + wCellr;
  const combined =
    total === 0
      ? null
      : one(((extAvg ?? 0) * wExt + stars.reduce((a, b) => a + b, 0) * w.cellr) / total);
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

/** The star row (1..5) of the distribution a CELLR score is counted in: the same folding as `starRows`. */
export const starRowOf = (score: number): number => Math.floor(cellrBucket(score) / 2) + 1;
