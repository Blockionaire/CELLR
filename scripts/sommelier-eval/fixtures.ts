import type { InventoryRow } from "@/server/cellar/types";
import { CELLARS, wineByKey, type ArchetypeWine } from "./wines";
import type { CellarMods, Scenario } from "./types";

/** The day every scenario happens on: drinking windows, "today" and offer ages are counted from here. */
export const NOW = new Date("2026-11-19T18:00:00Z");

const id = (kind: number, n: number) =>
  `00000000-0000-4000-8${kind.toString(16).padStart(3, "0")}-${n.toString(16).padStart(12, "0")}`;

export interface FixtureWine {
  key: string;
  wine: ArchetypeWine;
  vintageId: string;
  wineId: string;
  year: number | null;
  count: number;
  /** Bottles kept for an occasion. */
  reserved: number;
  /** Region, appellation and country are unknown. */
  stripped: boolean;
  /** A researched profile of the exact wine exists (its structure is known). */
  profiled: boolean;
  rating: number | null;
  favorite: boolean;
}

export interface Fixture {
  wines: FixtureWine[];
  rows: InventoryRow[];
  keyOfVintage: ReadonlyMap<string, string>;
  /** Bottle ids that are reserved (the last ones of a wine first, so the easiest bottle stays free). */
  reservedBottles: ReadonlySet<string>;
}

const has = (list: readonly string[] | "all" | undefined, key: string) =>
  list === "all" || (list?.includes(key) ?? false);

/** The cellar of a scenario, as inventory rows the app's own code reads. */
export function buildFixture(scenario: Pick<Scenario, "cellar" | "mods">): Fixture {
  const keys = CELLARS[scenario.cellar];
  if (!keys) throw new Error(`unknown cellar: ${scenario.cellar}`);
  const mods: CellarMods = scenario.mods ?? {};
  const wines: FixtureWine[] = keys.map((key, n) => {
    const wine = wineByKey(key);
    const count = mods.counts?.[key] ?? 2;
    return {
      key,
      wine,
      vintageId: id(1, n + 1),
      wineId: id(2, n + 1),
      year: mods.years?.[key] ?? wine.year,
      count,
      reserved: Math.min(count, mods.reserved?.[key] ?? 0),
      stripped: has(mods.strip, key),
      profiled: has(mods.profiles, key),
      rating: mods.ratings?.[key] ?? null,
      favorite: mods.favorites?.includes(key) ?? false,
    };
  });
  const rows: InventoryRow[] = [];
  const reservedBottles = new Set<string>();
  wines.forEach((f, n) => {
    for (let b = 0; b < f.count; b++) {
      const bottleId = id(3, n * 100 + b + 1);
      if (b >= f.count - f.reserved) reservedBottles.add(bottleId);
      rows.push({
        bottleId,
        vintageId: f.vintageId,
        wineId: f.wineId,
        producer: f.wine.producer,
        wineName: f.wine.name,
        type: f.wine.type,
        year: f.year,
        region: f.stripped ? null : f.wine.region,
        appellation: f.stripped ? null : f.wine.appellation,
        countryCode: f.stripped ? null : f.wine.countryCode,
        locationId: null,
        locationLabel: null,
        row: null,
        col: null,
        priceCents: f.wine.priceCents,
        currency: "EUR",
        addedAt: "2026-01-01T00:00:00Z",
        image: null,
      });
    }
  });
  return {
    wines,
    rows,
    keyOfVintage: new Map(wines.map((f) => [f.vintageId, f.key])),
    reservedBottles,
  };
}
