import { z } from "zod";
import { cellrBucket, poolExternal, ratingScore, type RatingScore } from "./rating-score";

/**
 * WHAT A WINE PAGE SHOWS ABOUT RATINGS (docs/sprints/ratings/DESIGN.md §4–5): per vintage, the provider's aggregate
 * (count, sum and distribution in half stars) and the CELLR community's published reviews, merged here so the
 * screen can recompute the CELLR score for any vintage filter with `selectRatings`. Never a weighted count, never a
 * made-up score: an empty selection says so.
 */

export const REVIEW_BODY_MAX = 1500;
export const REPORT_REASONS = ["spam", "offensive", "wrong_wine", "not_a_review", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

const Year = z.number().int().min(1800).max(2100).nullable();
const Distribution = z.array(z.number().int().min(0)).length(10);

/** catalog_wine_ratings / catalog_record_ratings, as the database returns it. */
export const ExternalRatingsRowSchema = z.object({
  recordId: z.string().uuid(),
  providerId: z.string().min(1).max(64),
  providerName: z.string().min(1).max(120),
  scope: z.literal("public"),
  datasetVersion: z.string().max(120).nullable(),
  method: z.string().max(40).nullable(),
  vintages: z
    .array(
      z.object({
        year: Year,
        count: z.number().int().min(1),
        average: z.number().min(0.5).max(5),
        distribution: Distribution,
        firstRatedOn: z.string().nullable(),
        lastRatedOn: z.string().nullable(),
      }),
    )
    .max(400),
});
export type ExternalRatingsRow = z.infer<typeof ExternalRatingsRowSchema>;

export const CommunityReviewSchema = z.object({
  id: z.string().uuid(),
  year: Year,
  score: z.number().min(1).max(10),
  body: z.string().max(REVIEW_BODY_MAX).nullable(),
  tastedOn: z.string(),
  publishedAt: z.string(),
  edited: z.boolean(),
  author: z.string().max(40).nullable(),
  mine: z.boolean(),
});
export type CommunityReview = z.infer<typeof CommunityReviewSchema>;

/** community_reviews_for_wine / _for_record. */
export const CommunityRowSchema = z.object({
  vintages: z
    .array(
      z.object({
        year: Year,
        count: z.number().int().min(1),
        scores: z.array(z.number().min(1).max(10)),
      }),
    )
    .max(400),
  reviews: z.array(CommunityReviewSchema).max(100),
  reviewable: z.boolean().optional(),
});
export type CommunityRow = z.infer<typeof CommunityRowSchema>;

export interface VintageRatings {
  year: number | null;
  external: { count: number; sumHalf: number; distribution: number[] } | null;
  cellr: { scores: number[]; distribution: number[] };
}

export interface WineRatingsData {
  /** Whether any ratings may be shown for this wine at all (an identity to rate by, a database step taken). */
  available: boolean;
  /** Whether the reader can publish a review of this wine (it has a catalogue identity). */
  reviewable: boolean;
  /** The external source behind the external numbers, for the methodology link; null without external ratings. */
  source: { providerName: string; datasetVersion: string | null } | null;
  /** Newest vintage first, NV last. */
  vintages: VintageRatings[];
  reviews: CommunityReview[];
}

export const NO_RATINGS: WineRatingsData = {
  available: false,
  reviewable: false,
  source: null,
  vintages: [],
  reviews: [],
};

const vintageKey = (y: number | null) => (y === null ? "nv" : String(y));

/** Merges the two database answers (either may be null: not available) into one view per vintage. */
export function mergeWineRatings(
  external: ExternalRatingsRow | null,
  community: CommunityRow | null,
): WineRatingsData {
  if (!external && !community) return NO_RATINGS;
  const byYear = new Map<string, VintageRatings>();
  const get = (year: number | null) => {
    const k = vintageKey(year);
    let v = byYear.get(k);
    if (!v) {
      v = { year, external: null, cellr: { scores: [], distribution: Array(10).fill(0) } };
      byYear.set(k, v);
    }
    return v;
  };
  for (const e of external?.vintages ?? []) {
    const sumHalf = e.distribution.reduce((a, n, i) => a + n * (i + 1), 0);
    get(e.year).external = { count: e.count, sumHalf, distribution: [...e.distribution] };
  }
  for (const c of community?.vintages ?? []) {
    const v = get(c.year);
    v.cellr.scores = [...c.scores];
    for (const s of c.scores) v.cellr.distribution[cellrBucket(s)]!++;
  }
  const vintages = [...byYear.values()].sort((a, b) =>
    a.year === b.year ? 0 : a.year === null ? 1 : b.year === null ? -1 : b.year - a.year,
  );
  return {
    available: true,
    reviewable: community?.reviewable === true,
    source: external
      ? { providerName: external.providerName, datasetVersion: external.datasetVersion }
      : null,
    vintages,
    reviews: community?.reviews ?? [],
  };
}

export type VintageFilter = "all" | number | "nv";
export type ReviewFilter = "all" | "with_text" | "mine";

export interface RatingsSelection {
  score: RatingScore;
  /** External half-star distribution, CELLR half-star distribution, for the selection. */
  externalDistribution: number[];
  cellrDistribution: number[];
  reviews: CommunityReview[];
}

/** The numbers for one vintage filter (all, a year, or NV) and one review filter. */
export function selectRatings(
  data: WineRatingsData,
  vintage: VintageFilter,
  reviews: ReviewFilter = "all",
): RatingsSelection {
  const match = (y: number | null) =>
    vintage === "all" ? true : vintage === "nv" ? y === null : y === vintage;
  const chosen = data.vintages.filter((v) => match(v.year));
  const ext = poolExternal(chosen.map((v) => v.external ?? { count: 0, sumHalf: 0 }));
  const scores = chosen.flatMap((v) => v.cellr.scores);
  const add = (a: number[], b: number[]) => a.map((n, i) => n + (b[i] ?? 0));
  const zero = Array(10).fill(0) as number[];
  return {
    score: ratingScore(ext, scores),
    externalDistribution: chosen.reduce((a, v) => add(a, v.external?.distribution ?? zero), zero),
    cellrDistribution: chosen.reduce((a, v) => add(a, v.cellr.distribution), zero),
    reviews: data.reviews.filter(
      (r) =>
        match(r.year) &&
        (reviews === "all" || (reviews === "with_text" ? r.body !== null : r.mine)),
    ),
  };
}

/** Publishing a review: the text the author writes for the public (optional) and the explicit consent. */
export const PublishReviewSchema = z.object({
  body: z
    .string()
    .max(REVIEW_BODY_MAX)
    .transform((s) => s.trim())
    .refine((s) => !/(https?:\/\/|www\.)/i.test(s), "Links are not allowed in a review.")
    .transform((s) => (s === "" ? null : s))
    .nullable()
    .default(null),
  consent: z.literal(true),
});
export type PublishReview = z.infer<typeof PublishReviewSchema>;

export const ReportReviewSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  detail: z.string().max(300).optional(),
});

export type PublishStatus =
  | "published"
  | "updated"
  | "not_yours"
  | "no_score"
  | "no_identity"
  | "no_consent"
  | "rate_limited"
  | "invalid_text";
