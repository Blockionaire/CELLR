import { normalizeText, type CellarItem, type WineType } from "./cellar";

/** What the cellar can be ordered by. `recent` is the order the server sends (newest additions first). */
export const SORTS = ["recent", "name", "producer", "vintageNew", "vintageOld", "count"] as const;
export type CellarSort = (typeof SORTS)[number];

/** Vintages grouped the way people talk about them. */
export const VINTAGE_BANDS = ["2020s", "2010s", "2000s", "older", "nv"] as const;
export type VintageBand = (typeof VINTAGE_BANDS)[number];

export function vintageBand(year: number | null): VintageBand {
  if (year === null) return "nv";
  if (year >= 2020) return "2020s";
  if (year >= 2010) return "2010s";
  if (year >= 2000) return "2000s";
  return "older";
}

/** Within one group any choice matches; across groups every group must match. Empty group = no restriction. */
export interface CellarFilters {
  types: WineType[];
  countries: string[];
  places: string[];
  bands: VintageBand[];
  favoritesOnly: boolean;
}

export const NO_FILTERS: CellarFilters = {
  types: [],
  countries: [],
  places: [],
  bands: [],
  favoritesOnly: false,
};

/** How many groups are narrowing the list right now (what a badge on the Filter button shows). */
export function activeFilterCount(f: CellarFilters): number {
  return (
    f.types.length +
    f.countries.length +
    f.places.length +
    f.bands.length +
    (f.favoritesOnly ? 1 : 0)
  );
}

export function applyFilters(items: readonly CellarItem[], f: CellarFilters): CellarItem[] {
  return items.filter(
    (i) =>
      (f.types.length === 0 || f.types.includes(i.type)) &&
      (f.countries.length === 0 ||
        (i.countryCode !== null && f.countries.includes(i.countryCode))) &&
      (f.places.length === 0 || i.places.some((p) => f.places.includes(p))) &&
      (f.bands.length === 0 || f.bands.includes(vintageBand(i.year))) &&
      (!f.favoritesOnly || i.favorite),
  );
}

/** A new list in the chosen order. Ties keep their incoming order, so the result never jumps around. */
export function sortItems(items: readonly CellarItem[], sort: CellarSort): CellarItem[] {
  const indexed = items.map((item, index) => ({ item, index }));
  const text = (a: string, b: string) => normalizeText(a).localeCompare(normalizeText(b), "en");
  const byName = (a: CellarItem, b: CellarItem) =>
    text(a.wineName, b.wineName) || text(a.producer, b.producer);
  const byProducer = (a: CellarItem, b: CellarItem) =>
    text(a.producer, b.producer) || text(a.wineName, b.wineName);
  // Non-vintage wines go last whichever way the years run.
  const year = (a: CellarItem, b: CellarItem, direction: 1 | -1) =>
    a.year === null && b.year === null
      ? 0
      : a.year === null
        ? 1
        : b.year === null
          ? -1
          : direction * (a.year - b.year);
  const compare: Record<CellarSort, (a: CellarItem, b: CellarItem) => number> = {
    recent: () => 0,
    name: byName,
    producer: byProducer,
    vintageNew: (a, b) => year(a, b, -1) || byName(a, b),
    vintageOld: (a, b) => year(a, b, 1) || byName(a, b),
    count: (a, b) => b.count - a.count || byName(a, b),
  };
  return indexed
    .sort((x, y) => compare[sort](x.item, y.item) || x.index - y.index)
    .map((x) => x.item);
}

export interface Facet<T extends string> {
  value: T;
  /** How many cards carry this value in the list as it is now. */
  count: number;
}

export interface Facets {
  types: Array<Facet<WineType>>;
  countries: Array<Facet<string>>;
  places: Array<Facet<string>>;
  bands: Array<Facet<VintageBand>>;
}

/** The choices worth offering, most common first, each with how many cards it would show. */
export function facetsOf(items: readonly CellarItem[]): Facets {
  const tally = <T extends string>(values: Iterable<T>): Array<Facet<T>> => {
    const counts = new Map<T, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };
  const bands = tally(items.map((i) => vintageBand(i.year)));
  return {
    types: tally(items.map((i) => i.type)),
    countries: tally(items.flatMap((i) => (i.countryCode ? [i.countryCode] : []))),
    places: tally(items.flatMap((i) => i.places)),
    // Bands keep their natural order (newest first), not "most common first".
    bands: [...bands].sort(
      (a, b) => VINTAGE_BANDS.indexOf(a.value) - VINTAGE_BANDS.indexOf(b.value),
    ),
  };
}
