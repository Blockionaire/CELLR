import {
  STORAGE_TEMPLATES,
  defaultAppearance,
  defaultZones,
  enumerateSlots,
  resolveStorage,
  slotKey,
  type LogicalLayout,
  type ResolvedStorage,
  type StorageAppearance,
  type StorageTemplateId,
  type WineType,
} from "@cellr/domain";
import { shapeFor } from "../wine-visuals";
import type { StoredBottle } from "./model";

/**
 * Made-up places and bottles for the gallery and the tests: the same every time, from nothing but numbers. No
 * database, no person's cellar.
 */

/** A seeded random (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FIXTURE_WINES: ReadonlyArray<{
  producer: string;
  name: string;
  type: WineType;
  year: number | null;
  /** Where it is from. As made up as the rest. */
  place: string;
}> = [
  {
    producer: "Domaine du Lac",
    name: "Les Pierres",
    type: "red",
    year: 2018,
    place: "Rhône, France",
  },
  { producer: "Castello Vento", name: "Riserva", type: "red", year: 2016, place: "Tuscany, Italy" },
  { producer: "Bodega Alta", name: "Gran Reserva", type: "red", year: 2012, place: "Rioja, Spain" },
  {
    producer: "Weingut Stein",
    name: "Riesling Kabinett",
    type: "white",
    year: 2021,
    place: "Mosel, Germany",
  },
  {
    producer: "Domaine Morel",
    name: "Chablis Vieilles Vignes",
    type: "white",
    year: 2020,
    place: "Burgundy, France",
  },
  {
    producer: "Maison Clair",
    name: "Brut Réserve",
    type: "sparkling",
    year: null,
    place: "Champagne, France",
  },
  { producer: "Mas des Roses", name: "Rosé", type: "rose", year: 2023, place: "Provence, France" },
  {
    producer: "Quinta Norte",
    name: "Vintage Port",
    type: "fortified",
    year: 2011,
    place: "Douro, Portugal",
  },
  {
    producer: "Château d'Or",
    name: "Sauternes",
    type: "dessert",
    year: 2015,
    place: "Bordeaux, France",
  },
  { producer: "Kabaj Brda", name: "Rebula", type: "orange", year: 2019, place: "Brda, Slovenia" },
];

export type Fill = "empty" | "partial" | "full";

export interface FixtureBottle extends StoredBottle {
  wine: (typeof FIXTURE_WINES)[number];
}

/**
 * Bottles for a layout: none, about half (the same half every time), or one on every spot. In a place with one
 * wine per shelf, as cellars tend to be kept, so that a picture of it reads as a cellar.
 */
export function fixtureBottles(layout: LogicalLayout, fill: Fill, seed = 7): FixtureBottle[] {
  if (fill === "empty") return [];
  const rnd = seeded(seed);
  const out: FixtureBottle[] = [];
  for (const slot of enumerateSlots(layout)) {
    const keep = rnd(); // drawn for every spot, so "partial" is a subset of "full" with the same wines
    if (fill === "partial" && keep > 0.55) continue;
    const wine =
      FIXTURE_WINES[(slot.row * 3 + Math.floor((slot.col - 1) / 2)) % FIXTURE_WINES.length]!;
    out.push({
      id: `b-${slotKey(slot)}`,
      row: slot.row,
      col: slot.col,
      index: slot.index,
      type: wine.type,
      shape: shapeFor(wine.type),
      wine,
    });
  }
  return out;
}

export interface FixturePlace {
  template: StorageTemplateId;
  rows?: number;
  cols?: number;
  cellCapacity?: number;
  appearance?: Partial<Omit<StorageAppearance, "v">>;
}

/** A place of a template as the database would hold it, read back through the domain's own adapter. */
export function fixturePlace(place: FixturePlace): ResolvedStorage {
  const t = STORAGE_TEMPLATES[place.template];
  const rows = place.rows ?? t.rows.default;
  return resolveStorage({
    kind: t.kind,
    rows,
    cols: place.cols ?? t.cols.default,
    template: t.id,
    cellCapacity: place.cellCapacity ?? t.cellCapacity.default,
    semantics: t.semantics,
    zones: t.zones ? defaultZones(t, rows) : undefined,
    appearance: { ...defaultAppearance(t.id), ...place.appearance },
  });
}
