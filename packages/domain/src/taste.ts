import { z } from "zod";
import { WINE_TYPES, type WineType } from "./cellar";

/**
 * MY TASTE PROFILE: what I have tasted, what I consistently rated highly, and where I like a wine to sit on the
 * four scales wine apps use. Deterministic: worked out from my own tastings in my active household (and, where
 * they exist, the curated grapes and the evidence-qualified AI profiles of those wines). No AI is asked.
 *
 * AGGREGATION POLICY
 * - One point per wine (producer + wine name), not per tasting: tasting the same wine three times, of the same
 *   vintage or not, counts once. Its score is the mean of my scores for that wine; unscored tastings only count
 *   towards "tasted".
 * - "Tasted" (frequency) and "rated highly" (preference) are kept apart.
 * - A favourite region, grape or style needs at least MIN_FAVOURITE_WINES different rated wines in it, with a
 *   mean of at least FAVOURITE_MIN_SCORE (3.5 stars). One great bottle is not a favourite region.
 * - Grapes come only from the curated wine_grapes list, or from an AI profile that rests on this exact wine or
 *   on the appellation's own rules. Never from a regional guess.
 * - A trend on a scale needs at least MIN_TREND_WINES wines I rated 4 stars or more, each with a reliable
 *   structure (an AI profile that is not a bare style estimate and not low confidence). Otherwise: no trend.
 */

export const MIN_FAVOURITE_WINES = 3;
export const FAVOURITE_MIN_SCORE = 7; // 3.5 stars, on the stored 1..10 scale
export const MIN_TREND_WINES = 3;
export const TREND_MIN_SCORE = 8; // 4 stars
export const MIN_TYPE_RATED = 2;

export const TASTE_SCALES = ["body", "tannin", "sweetness", "acidity"] as const;
export type TasteScale = (typeof TASTE_SCALES)[number];

export const WINE_FOCUS = ["red", "white_rose", "both"] as const;
export type WineFocus = (typeof WINE_FOCUS)[number];

const scaleValue = z.number().int().min(1).max(5).nullable();

/** What a person tells CELLR about their taste. Every field optional: null = not said (or cleared). */
export const SaveTastePreferencesSchema = z.object({
  wineFocus: z.enum(WINE_FOCUS).nullable(),
  body: scaleValue,
  tannin: scaleValue,
  sweetness: scaleValue,
  acidity: scaleValue,
  /** Mark the short onboarding as done (answered or skipped). */
  onboarded: z.boolean().optional(),
});
export type SaveTastePreferences = z.infer<typeof SaveTastePreferencesSchema>;

export interface TastePreferences {
  wineFocus: WineFocus | null;
  body: number | null;
  tannin: number | null;
  sweetness: number | null;
  acidity: number | null;
  onboarded: boolean;
}

export const NO_PREFERENCES: TastePreferences = {
  wineFocus: null,
  body: null,
  tannin: null,
  sweetness: null,
  acidity: null,
  onboarded: false,
};

/** One of my tastings, with what is known about its wine. */
export interface TasteTasting {
  wineId: string;
  vintageId: string;
  producer: string;
  wineName: string;
  year: number | null;
  type: WineType;
  region: string | null;
  appellation: string | null;
  /** 1..10, or null when only words or a note were left. */
  score: number | null;
  /** Grapes from the curated catalogue (wine_grapes), or from an AI profile that rests on this wine. */
  grapes: string[];
  /** The wine's structure (1..5 each) from a reliable AI profile of this vintage; null when there is none. */
  structure: Partial<Record<TasteScale, number | null>> | null;
}

export interface WineRef {
  vintageId: string;
  producer: string;
  wineName: string;
  year: number | null;
  /** Mean of my scores for this wine, 1..10. */
  score: number;
}

export interface Favourite {
  /** A region, grape or kind of wine (WineType for styles). */
  key: string;
  wines: number;
  /** Mean over its wines, in stars, one decimal. */
  average: number;
  /** The best of those wines, to look at again. */
  examples: WineRef[];
}

export interface TasteSection {
  /** All tastings and different wines tasted (frequency, not preference). */
  tastings: number;
  winesTasted: number;
  winesRated: number;
  /** Mean over rated wines (one per wine), in stars; null without any. */
  average: number | null;
  /** Rated highly, with enough different wines behind it. */
  favouriteRegions: Favourite[];
  favouriteGrapes: Favourite[];
  /** Overview only: kinds of wine I rate highly. */
  favouriteStyles: Favourite[];
  /** Most tasted regions (frequency), apart from preference. */
  mostTastedRegions: Array<{ key: string; wines: number }>;
  /** Trend on each scale from wines I rated highly; null when the evidence is too thin. */
  trends: Record<TasteScale, { value: number; wines: number } | null>;
  /** Whether grapes are known for enough wines to say anything about grapes. */
  grapesKnown: number;
}

export interface TasteProfileView {
  ready: { tastings: boolean; preferences: boolean };
  preferences: TastePreferences;
  /** Different wines tasted, per kind of wine (always all kinds present). */
  distribution: Array<{
    type: WineType;
    wines: number;
    tastings: number;
    average: number | null;
    rated: number;
  }>;
  overview: TasteSection;
  /** Per kind of wine, for every kind I have tasted. */
  byType: Partial<Record<WineType, TasteSection>>;
}

/** The tabs: Overview, the four main kinds always, and any other kind I have tasted. */
export const MAIN_TASTE_TYPES = [
  "red",
  "white",
  "rose",
  "sparkling",
] as const satisfies readonly WineType[];
export function tasteTabs(view: Pick<TasteProfileView, "byType">): WineType[] {
  const others = WINE_TYPES.filter(
    (t) => !(MAIN_TASTE_TYPES as readonly WineType[]).includes(t) && view.byType[t],
  );
  return [...MAIN_TASTE_TYPES, ...others];
}

const stars = (score: number) => Math.round((score / 2) * 10) / 10;
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const clean = (s: string | null) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

interface WinePoint {
  wineId: string;
  type: WineType;
  region: string | null;
  grapes: string[];
  tastings: number;
  score: number | null;
  /** The vintage shown when this wine is an example (the best-scored, then the latest). */
  ref: Omit<WineRef, "score">;
  structure: Partial<Record<TasteScale, number[]>>;
}

/** One point per wine: the mean of its scores, every grape and structure value known for it. */
export function winePoints(tastings: readonly TasteTasting[]): WinePoint[] {
  const by = new Map<string, { t: TasteTasting[] }>();
  for (const t of tastings) {
    const g = by.get(t.wineId) ?? { t: [] };
    g.t.push(t);
    by.set(t.wineId, g);
  }
  return [...by.values()].map(({ t }) => {
    const scored = t.filter((x) => x.score !== null);
    const best = [...t].sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.year ?? 0) - (a.year ?? 0),
    )[0]!;
    const structure: WinePoint["structure"] = {};
    for (const x of t)
      for (const s of TASTE_SCALES) {
        const v = x.structure?.[s];
        if (typeof v === "number" && v >= 1 && v <= 5) (structure[s] ??= []).push(v);
      }
    return {
      wineId: best.wineId,
      type: best.type,
      region: clean(best.region),
      grapes: [...new Set(t.flatMap((x) => x.grapes.map((g) => g.trim()).filter(Boolean)))],
      tastings: t.length,
      score: scored.length ? mean(scored.map((x) => x.score!)) : null,
      ref: {
        vintageId: best.vintageId,
        producer: best.producer,
        wineName: best.wineName,
        year: best.year,
      },
      structure,
    };
  });
}

function favourites(points: readonly WinePoint[], keysOf: (p: WinePoint) => string[]): Favourite[] {
  const groups = new Map<string, WinePoint[]>();
  for (const p of points) {
    if (p.score === null) continue;
    for (const k of keysOf(p)) groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups.entries()]
    .map(([key, ps]) => ({ key, ps, m: mean(ps.map((p) => p.score!)) }))
    .filter((g) => g.ps.length >= MIN_FAVOURITE_WINES && g.m >= FAVOURITE_MIN_SCORE)
    .sort((a, b) => b.m - a.m || b.ps.length - a.ps.length || a.key.localeCompare(b.key))
    .slice(0, 3)
    .map((g) => ({
      key: g.key,
      wines: g.ps.length,
      average: stars(g.m),
      examples: [...g.ps]
        .sort((a, b) => b.score! - a.score!)
        .slice(0, 3)
        .map((p) => ({ ...p.ref, score: Math.round(p.score!) })),
    }));
}

export function tasteSection(
  tastings: readonly TasteTasting[],
  { styles = false }: { styles?: boolean } = {},
): TasteSection {
  const points = winePoints(tastings);
  const rated = points.filter((p) => p.score !== null);
  const regionCounts = new Map<string, number>();
  for (const p of points)
    if (p.region) regionCounts.set(p.region, (regionCounts.get(p.region) ?? 0) + 1);
  const trends = Object.fromEntries(
    TASTE_SCALES.map((s) => {
      const vals = rated
        .filter((p) => p.score! >= TREND_MIN_SCORE && p.structure[s]?.length)
        .map((p) => mean(p.structure[s]!));
      return [
        s,
        vals.length >= MIN_TREND_WINES
          ? { value: Math.round(mean(vals) * 10) / 10, wines: vals.length }
          : null,
      ];
    }),
  ) as TasteSection["trends"];
  return {
    tastings: tastings.length,
    winesTasted: points.length,
    winesRated: rated.length,
    average: rated.length ? stars(mean(rated.map((p) => p.score!))) : null,
    favouriteRegions: favourites(points, (p) => (p.region ? [p.region] : [])),
    favouriteGrapes: favourites(points, (p) => p.grapes),
    favouriteStyles: styles ? favourites(points, (p) => [p.type]) : [],
    mostTastedRegions: [...regionCounts.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([key, wines]) => ({ key, wines })),
    trends,
    grapesKnown: points.filter((p) => p.grapes.length > 0).length,
  };
}

/** The whole profile, from my tastings and my own answers. */
export function buildTasteProfile(
  tastings: readonly TasteTasting[],
  preferences: TastePreferences,
  ready: TasteProfileView["ready"] = { tastings: true, preferences: true },
): TasteProfileView {
  const byType: TasteProfileView["byType"] = {};
  const distribution: TasteProfileView["distribution"] = [];
  for (const type of WINE_TYPES) {
    const of = tastings.filter((t) => t.type === type);
    if (of.length === 0) continue;
    const section = tasteSection(of);
    // Tannin says little about white, rosé or sparkling wine.
    if (type !== "red" && type !== "orange") section.trends.tannin = null;
    byType[type] = section;
    distribution.push({
      type,
      wines: section.winesTasted,
      tastings: section.tastings,
      rated: section.winesRated,
      average: section.winesRated >= MIN_TYPE_RATED ? section.average : null,
    });
  }
  distribution.sort((a, b) => b.wines - a.wines);
  return {
    ready,
    preferences,
    distribution,
    overview: tasteSection(tastings, { styles: true }),
    byType,
  };
}

/** Which taste questions to offer for a focus: tannin only matters when red is in the picture. */
export const scalesFor = (focus: WineFocus | null): TasteScale[] =>
  focus === "white_rose" ? ["body", "sweetness", "acidity"] : [...TASTE_SCALES];

/** The short onboarding is offered while the person has said nothing yet and has tasted little. */
export const offerTasteOnboarding = (view: Pick<TasteProfileView, "preferences" | "overview">) =>
  !view.preferences.onboarded && view.overview.winesRated < MIN_FAVOURITE_WINES;
