/**
 * CATALOGUE RATINGS: a provider's numeric ratings, turned into aggregates per exact record and vintage
 * (docs/sprints/ratings/DESIGN.md). Pure: the importer (scripts/catalog-tools/ratings.ts) streams the file and calls
 * these; the database (20261129000051) stores only what `aggregateUnit` returns.
 *
 * Rules
 * - The unit is (provider wine id, vintage): every cuvée is its own record, never grouped by name. NV is its own
 *   vintage (null); a vintage that is neither a year nor "N.V." is invalid, never NV.
 * - A rating is a half-star step from 0.5 to 5.0, stored as half stars (1..10); anything else is invalid.
 * - One rating per rater per unit: the latest (by date, then by the file's rating id). Repeated ratings are counted
 *   and dropped, never averaged in twice.
 * - No rater id leaves this module's caller: an aggregate holds counts, a sum, a distribution and two months only
 *   (the payload drops the day).
 */

/** The X-Wines ratings file's header (XWines_Full_21M_ratings.csv, verified against the real file 2026-11-25). */
export const XWINES_RATINGS_HEADER = [
  "RatingID",
  "UserID",
  "WineID",
  "Vintage",
  "Rating",
  "Date",
] as const;

/** How one rating per rater is chosen; stored with every rating run. */
export const RATING_METHOD = "latest-per-rater-v1";

export type RatingRowProblem =
  "columns" | "rating_id" | "rater_id" | "wine_id" | "vintage" | "rating" | "date";

export interface RatingRow {
  ratingId: number;
  raterId: string;
  wineId: string;
  /** A year, or null for NV. */
  vintage: number | null;
  /** Half stars, 1..10 (4.5 stars = 9). */
  half: number;
  /** "YYYY-MM-DD HH:MM:SS", as in the file; compared as text (it sorts by time). */
  ratedAt: string;
}

const DIGITS = /^[0-9]{1,12}$/;
const YEAR = /^[0-9]{4}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const RATING = /^[0-5](\.[05])?$/;

/** One line of the ratings file, already split on commas. */
export function parseRatingRow(
  fields: readonly string[],
): { ok: true; row: RatingRow } | { ok: false; problem: RatingRowProblem } {
  if (fields.length !== 6) return { ok: false, problem: "columns" };
  const [rid, uid, wid, vin, rat, dat] = fields as [string, string, string, string, string, string];
  if (!DIGITS.test(rid)) return { ok: false, problem: "rating_id" };
  if (!DIGITS.test(uid)) return { ok: false, problem: "rater_id" };
  if (!DIGITS.test(wid)) return { ok: false, problem: "wine_id" };
  let vintage: number | null;
  if (vin === "N.V.") vintage = null;
  else if (YEAR.test(vin) && Number(vin) >= 1800 && Number(vin) <= 2100) vintage = Number(vin);
  else return { ok: false, problem: "vintage" };
  if (!RATING.test(rat)) return { ok: false, problem: "rating" };
  const half = Math.round(Number(rat) * 2);
  if (half < 1 || half > 10) return { ok: false, problem: "rating" };
  const m = DATE.exec(dat);
  if (!m) return { ok: false, problem: "date" };
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (
    t.getUTCFullYear() !== y ||
    t.getUTCMonth() !== mo - 1 ||
    t.getUTCDate() !== d ||
    h > 23 ||
    mi > 59 ||
    s > 59 ||
    y < 1990 ||
    y > 2100
  )
    return { ok: false, problem: "date" };
  return {
    ok: true,
    row: { ratingId: Number(rid), raterId: uid, wineId: wid, vintage, half, ratedAt: dat },
  };
}

/** One rating as the aggregation needs it (the rater as an opaque key, e.g. a keyed hash). */
export interface UnitRating {
  rater: string;
  half: number;
  ratedAt: string;
  ratingId: number;
}

export interface RatingAggregate {
  count: number;
  /** Sum in half stars. */
  sumHalf: number;
  /** Ratings at 0.5, 1.0, … 5.0 stars. */
  distribution: number[];
  /** YYYY-MM-DD of the first and the last rating kept. */
  first: string;
  last: string;
  /** Ratings dropped because the same rater rated this unit again later. */
  repeated: number;
}

/** True when rating a is later than rating b (date, then the file's id). */
const later = (a: UnitRating, b: UnitRating) =>
  a.ratedAt > b.ratedAt || (a.ratedAt === b.ratedAt && a.ratingId > b.ratingId);

/** The aggregate of one unit's ratings: one per rater (the latest). */
export function aggregateUnit(ratings: readonly UnitRating[]): RatingAggregate {
  if (ratings.length === 0) throw new Error("a unit has at least one rating");
  const latest = new Map<string, UnitRating>();
  for (const r of ratings) {
    const seen = latest.get(r.rater);
    if (!seen || later(r, seen)) latest.set(r.rater, r);
  }
  const distribution = Array.from({ length: 10 }, () => 0);
  let sumHalf = 0;
  let first = "";
  let last = "";
  for (const r of latest.values()) {
    distribution[r.half - 1]!++;
    sumHalf += r.half;
    const day = r.ratedAt.slice(0, 10);
    if (first === "" || day < first) first = day;
    if (last === "" || day > last) last = day;
  }
  return {
    count: latest.size,
    sumHalf,
    distribution,
    first,
    last,
    repeated: ratings.length - latest.size,
  };
}

/** The payload unit catalog_rating_import accepts. */
export interface RatingUnitPayload {
  external_id: string;
  vintage: number | null;
  count: number;
  sum_half: number;
  distribution: number[];
  first: string;
  last: string;
}

/** YYYY-MM-DD → YYYY-MM-01: the database keeps months only, never the day of a rating. */
export const monthOf = (day: string) => `${day.slice(0, 7)}-01`;

export function unitPayload(
  wineId: string,
  vintage: number | null,
  a: RatingAggregate,
): RatingUnitPayload {
  return {
    external_id: wineId,
    vintage,
    count: a.count,
    sum_half: a.sumHalf,
    distribution: a.distribution,
    first: monthOf(a.first),
    last: monthOf(a.last),
  };
}
