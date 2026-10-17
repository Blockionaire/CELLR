import { estimateDrinkWindow, type DrinkPhase, drinkStatus } from "./drink-window";
import type { WineType } from "./cellar";

/**
 * THE CELLAR IN NUMBERS. Everything here is worked out from what the household already keeps — bottles,
 * what they cost, what was opened and when, what people thought of it, and (when someone asked for it) what
 * a bottle is worth now — so there is nothing to fill in. Drink windows are the same estimates as everywhere.
 */

export interface StatsBottle {
  vintageId: string;
  wineId: string;
  producer: string;
  wineName: string;
  type: WineType;
  year: number | null;
  region: string | null;
  appellation: string | null;
  countryCode: string | null;
  priceCents: number | null;
  /** The AI's drinking window for this vintage, when it gave one it was sure about. */
  aiWindow?: { from: number; until: number } | null;
}

export interface StatsOpened {
  vintageId: string;
  producer: string;
  wineName: string;
  type: WineType;
  year: number | null;
  /** ISO timestamp */
  openedAt: string;
}

export interface StatsInput {
  /** Bottles in the cellar now. */
  bottles: readonly StatsBottle[];
  /** Bottles that were opened (any time). */
  opened: readonly StatsOpened[];
  /** Every rating given (1..10 = half stars), per vintage. */
  scores: ReadonlyArray<{ vintageId: string; score: number }>;
  /** What one bottle of a vintage is worth now, where known (the household's own number, else the AI's middle). */
  values: ReadonlyArray<{ vintageId: string; valueCents: number }>;
  currency: string;
  now: Date;
}

export interface Count<K extends string = string> {
  key: K;
  count: number;
}

export interface StatsView {
  generatedAt: string;
  currency: string;
  bottleCount: number;
  wineCount: number;
  openedCount: number;
  money: {
    /** What the bottles in the cellar cost, from the prices that are known. */
    spentCents: number | null;
    pricedCount: number;
    averagePriceCents: number | null;
    /** What they are worth now, from the values that are known. */
    worthCents: number | null;
    valuedCount: number;
    /** Worth minus cost, over the bottles that have both a price and a value. */
    gainCents: number | null;
    comparedCount: number;
  };
  byType: Count<WineType>[];
  byCountry: Count[];
  byRegion: Count[];
  byDecade: Count[];
  byProducer: Count[];
  /** Bottles per stage of their drinking window, today. */
  byPhase: Count<DrinkPhase>[];
  /** For each of the next years: bottles whose window covers it, and of those how many are at their very best. */
  readyByYear: Array<{ year: number; ready: number; peak: number }>;
  /** The last twelve months, oldest first: bottles opened in each. */
  openedByMonth: Array<{ month: string; count: number }>;
  topRated: Array<{
    vintageId: string;
    producer: string;
    wineName: string;
    year: number | null;
    /** Average stars, 0.5 – 5. */
    stars: number;
    ratings: number;
  }>;
  ratingByType: Array<{ type: WineType; stars: number; ratings: number }>;
}

const sortedCounts = <K extends string>(map: Map<K, number>, limit = Infinity): Count<K>[] =>
  [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);

const bump = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);

/** "2010s", or "older" before 1960, or "nv". */
export function decadeOf(year: number | null): string {
  if (year === null) return "nv";
  if (year < 1960) return "older";
  return `${Math.floor(year / 10) * 10}s`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildStats(input: StatsInput): StatsView {
  const { bottles, opened, now } = input;
  const nowYear = now.getUTCFullYear();

  // ---- What they are -------------------------------------------------------------------------------------------
  const type = new Map<WineType, number>();
  const country = new Map<string, number>();
  const region = new Map<string, number>();
  const decade = new Map<string, number>();
  const producer = new Map<string, number>();
  const phase = new Map<DrinkPhase, number>();
  const years = Array.from({ length: 15 }, (_, i) => ({ year: nowYear + i, ready: 0, peak: 0 }));

  const valueOf = new Map(input.values.map((v) => [v.vintageId, v.valueCents]));
  let spent = 0;
  let priced = 0;
  let worth = 0;
  let valued = 0;
  let comparedPaid = 0;
  let comparedWorth = 0;
  let compared = 0;

  for (const b of bottles) {
    bump(type, b.type);
    bump(country, b.countryCode ?? "unknown");
    if (b.region) bump(region, b.countryCode ? `${b.region}|${b.countryCode}` : b.region);
    bump(decade, decadeOf(b.year));
    bump(producer, b.producer);

    const window = estimateDrinkWindow({
      type: b.type,
      year: b.year,
      region: b.region,
      appellation: b.appellation,
      countryCode: b.countryCode,
      name: b.wineName,
      pricePerBottleCents: b.priceCents,
      aiWindow: b.aiWindow ?? null,
    });
    bump(phase, drinkStatus(window, now).phase);
    if (window) {
      const span = Math.max(1, window.until - window.from);
      const peakFrom = window.from + 0.25 * span;
      const peakUntil = window.from + 0.7 * span;
      for (const y of years) {
        if (y.year >= window.from && y.year <= window.until) y.ready += 1;
        if (y.year >= peakFrom && y.year <= peakUntil) y.peak += 1;
      }
    }

    if (b.priceCents !== null) {
      spent += b.priceCents;
      priced += 1;
    }
    const value = valueOf.get(b.vintageId);
    if (value !== undefined) {
      worth += value;
      valued += 1;
      if (b.priceCents !== null) {
        comparedPaid += b.priceCents;
        comparedWorth += value;
        compared += 1;
      }
    }
  }

  // ---- What was drunk, and what people thought -----------------------------------------------------------------
  const months: Array<{ month: string; count: number }> = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ month: d.toISOString().slice(0, 7), count: 0 });
  }
  const byMonth = new Map(months.map((m) => [m.month, m]));
  for (const o of opened) {
    const m = byMonth.get(o.openedAt.slice(0, 7));
    if (m) m.count += 1;
  }

  const names = new Map<
    string,
    { producer: string; wineName: string; year: number | null; type: WineType }
  >();
  for (const b of bottles)
    names.set(b.vintageId, {
      producer: b.producer,
      wineName: b.wineName,
      year: b.year,
      type: b.type,
    });
  for (const o of opened)
    if (!names.has(o.vintageId))
      names.set(o.vintageId, {
        producer: o.producer,
        wineName: o.wineName,
        year: o.year,
        type: o.type,
      });

  const perVintage = new Map<string, number[]>();
  for (const s of input.scores) {
    const list = perVintage.get(s.vintageId) ?? [];
    list.push(s.score / 2);
    perVintage.set(s.vintageId, list);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const rated = [...perVintage.entries()].flatMap(([vintageId, stars]) => {
    const name = names.get(vintageId);
    return name ? [{ vintageId, ...name, stars: round1(mean(stars)), ratings: stars.length }] : [];
  });
  const topRated = [...rated]
    .sort(
      (a, b) => b.stars - a.stars || b.ratings - a.ratings || a.wineName.localeCompare(b.wineName),
    )
    .slice(0, 5)
    .map(({ vintageId, producer: p, wineName, year, stars, ratings }) => ({
      vintageId,
      producer: p,
      wineName,
      year,
      stars,
      ratings,
    }));
  const byTypeRatings = new Map<WineType, number[]>();
  for (const r of rated) {
    const list = byTypeRatings.get(r.type) ?? [];
    list.push(r.stars);
    byTypeRatings.set(r.type, list);
  }
  const ratingByType = [...byTypeRatings.entries()]
    .map(([t, xs]) => ({ type: t, stars: round1(mean(xs)), ratings: xs.length }))
    .sort((a, b) => b.stars - a.stars || a.type.localeCompare(b.type));

  return {
    generatedAt: now.toISOString(),
    currency: input.currency,
    bottleCount: bottles.length,
    wineCount: new Set(bottles.map((b) => b.wineId)).size,
    openedCount: opened.length,
    money: {
      spentCents: priced > 0 ? spent : null,
      pricedCount: priced,
      averagePriceCents: priced > 0 ? Math.round(spent / priced) : null,
      worthCents: valued > 0 ? worth : null,
      valuedCount: valued,
      gainCents: compared > 0 ? comparedWorth - comparedPaid : null,
      comparedCount: compared,
    },
    byType: sortedCounts(type),
    byCountry: sortedCounts(country, 8),
    byRegion: sortedCounts(region, 8),
    byDecade: [...sortedCounts(decade)].sort((a, b) => decadeOrder(a.key) - decadeOrder(b.key)),
    byProducer: sortedCounts(producer, 5),
    byPhase: sortedCounts(phase),
    readyByYear: years,
    openedByMonth: months,
    topRated,
    ratingByType,
  };
}

/** Old to new, with "older" first and "nv" last, for a chart read left to right. */
function decadeOrder(key: string): number {
  if (key === "older") return 0;
  if (key === "nv") return 9999;
  return Number.parseInt(key, 10);
}
