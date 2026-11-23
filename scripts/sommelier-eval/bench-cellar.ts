import {
  PROFILE_VERSION,
  type CellarItem,
  type CellarView,
  type InsightOutput,
  type Reservation,
  type WineType,
} from "@cellr/domain";
import { aggregateInventory } from "@/server/cellar/service";
import type { InventoryRow } from "@/server/cellar/types";
import { NOW } from "./fixtures";
import { WINES } from "./wines";

/**
 * GENERATED CELLARS FOR THE V1+ BENCHMARKS (P8). Deterministic (a fixed seed per size), realistic in shape: the 30
 * archetypes of wines.ts plus 26 more styles, invented producers, vintages spread around each style's usual age,
 * one to twelve bottles, bottles in named places or without one, some reserved for an occasion, some rated or
 * starred, some with the AI's drinking window and a researched profile. Built into a cellar view by the app's own
 * `aggregateInventory`, so the items are what the service reads in production.
 *
 * Three anchor wines with distinctive producers lead every cellar, so a question can name them ("the Vajrelli
 * Barolo") and the serving facts and the comparison find exactly one wine each.
 */

interface Style {
  name: string;
  type: WineType;
  region: string;
  appellation: string;
  countryCode: string;
  /** The usual vintage (null: non-vintage). */
  year: number | null;
  euros: number;
}

// prettier-ignore
const EXTRA: readonly Style[] = [
  { name: "Pouilly-Fumé", type: "white", region: "Loire", appellation: "Pouilly-Fumé", countryCode: "FR", year: 2022, euros: 26 },
  { name: "Vouvray Sec", type: "white", region: "Loire", appellation: "Vouvray", countryCode: "FR", year: 2021, euros: 20 },
  { name: "Puligny-Montrachet", type: "white", region: "Burgundy", appellation: "Puligny-Montrachet", countryCode: "FR", year: 2020, euros: 75 },
  { name: "Soave Classico", type: "white", region: "Veneto", appellation: "Soave Classico", countryCode: "IT", year: 2023, euros: 14 },
  { name: "Verdicchio dei Castelli di Jesi", type: "white", region: "Marche", appellation: "Verdicchio dei Castelli di Jesi", countryCode: "IT", year: 2022, euros: 13 },
  { name: "Riesling Smaragd", type: "white", region: "Wachau", appellation: "Wachau", countryCode: "AT", year: 2020, euros: 38 },
  { name: "Riesling Spätlese", type: "white", region: "Rheingau", appellation: "Rheingau", countryCode: "DE", year: 2019, euros: 24 },
  { name: "Assyrtiko", type: "white", region: "Santorini", appellation: "Santorini", countryCode: "GR", year: 2022, euros: 28 },
  { name: "Chardonnay", type: "white", region: "Sonoma Coast", appellation: "Sonoma Coast", countryCode: "US", year: 2021, euros: 35 },
  { name: "Sauvignon Blanc", type: "white", region: "Marlborough", appellation: "Marlborough", countryCode: "NZ", year: 2023, euros: 15 },
  { name: "Crémant de Loire", type: "sparkling", region: "Loire", appellation: "Crémant de Loire", countryCode: "FR", year: null, euros: 14 },
  { name: "Franciacorta Brut", type: "sparkling", region: "Lombardy", appellation: "Franciacorta", countryCode: "IT", year: null, euros: 30 },
  { name: "Champagne Blanc de Blancs", type: "sparkling", region: "Champagne", appellation: "Champagne", countryCode: "FR", year: 2015, euros: 70 },
  { name: "Bandol Rosé", type: "rose", region: "Provence", appellation: "Bandol", countryCode: "FR", year: 2023, euros: 25 },
  { name: "Pinot Noir", type: "red", region: "Central Otago", appellation: "Central Otago", countryCode: "NZ", year: 2020, euros: 38 },
  { name: "Brunello di Montalcino", type: "red", region: "Tuscany", appellation: "Brunello di Montalcino", countryCode: "IT", year: 2016, euros: 60 },
  { name: "Barbaresco", type: "red", region: "Piedmont", appellation: "Barbaresco", countryCode: "IT", year: 2018, euros: 48 },
  { name: "Côte-Rôtie", type: "red", region: "Rhône", appellation: "Côte-Rôtie", countryCode: "FR", year: 2017, euros: 65 },
  { name: "Saint-Émilion Grand Cru", type: "red", region: "Bordeaux", appellation: "Saint-Émilion Grand Cru", countryCode: "FR", year: 2016, euros: 45 },
  { name: "Margaux", type: "red", region: "Bordeaux", appellation: "Margaux", countryCode: "FR", year: 2014, euros: 80 },
  { name: "Ribera del Duero Crianza", type: "red", region: "Ribera del Duero", appellation: "Ribera del Duero", countryCode: "ES", year: 2019, euros: 22 },
  { name: "Priorat", type: "red", region: "Catalonia", appellation: "Priorat", countryCode: "ES", year: 2018, euros: 40 },
  { name: "Douro Tinto", type: "red", region: "Douro", appellation: "Douro", countryCode: "PT", year: 2019, euros: 18 },
  { name: "Shiraz", type: "red", region: "Barossa Valley", appellation: "Barossa Valley", countryCode: "AU", year: 2018, euros: 30 },
  { name: "Tokaji Aszú 5 Puttonyos", type: "dessert", region: "Tokaj", appellation: "Tokaji", countryCode: "HU", year: 2013, euros: 45 },
  { name: "Madeira Sercial 10 Years", type: "fortified", region: "Madeira", appellation: "Madeira", countryCode: "PT", year: null, euros: 35 },
];

const STYLES: readonly Style[] = [
  ...WINES.map((w) => ({
    name: w.name,
    type: w.type,
    region: w.region,
    appellation: w.appellation,
    countryCode: w.countryCode,
    year: w.year,
    euros: Math.round(w.priceCents / 100),
  })),
  ...EXTRA,
];

/** Invented producers (none of them shares a word with the anchors). */
// prettier-ignore
const PRODUCERS = [
  "Domaine des Lauriers", "Château Belcastel", "Bodega Altamira", "Tenuta San Lorenzo", "Weingut Hofmeister",
  "Quinta da Ribeira", "Domaine Morel-Vasseur", "Cantina Le Colline", "Clos des Fontaines", "Maison Arnoux",
  "Château La Grave Haute", "Bodegas Peñalba", "Azienda Agricola Ferrante", "Weingut Steinbach", "Domaine Rivière",
  "Cave de la Côte", "Tenuta Belvedere", "Domaine Garnier Frères", "Château Peyrolles", "Quinta do Vale Escuro",
  "Mas des Oliviers", "Domaine Saint-Aubin", "Cantine Ricci", "Bodegas Monteviejo", "Weingut Kranz",
  "Domaine Lefèvre", "Château des Tourelles", "Estate Kerrigan", "Domaine Bonnard", "Tenuta Montecalvo",
  "Clos Sainte-Anne", "Ktima Lykos", "Domaine du Pressoir", "Bodega Los Almendros", "Château Roquemaure",
  "Weingut Adler", "Domaine Chevalier-Roux", "Cantina del Lago", "Domaine de la Pierre Blanche", "Hillcrest Cellars",
];

/** Anchors: the wines a question names. Distinctive producers, so each is found exactly once. */
export const ANCHORS = [
  { producer: "Vajrelli", style: "Barolo", year: 2016 },
  { producer: "Château Montrachaux", style: "Pauillac", year: 2015 },
  { producer: "Domaine Fleurignac", style: "Chablis", year: 2022 },
] as const;

const PLACES = [
  "Wine fridge",
  "Rack A",
  "Rack B",
  "Cellar, shelf 2",
  "Kitchen cupboard",
  "Off-site storage",
];
const PLACE_IDS = PLACES.map((_, k) => `0000000${k}-0000-4000-8000-00000000000${k}`);
const OCCASIONS = ["Anniversary", "Christmas dinner", "Lena's 30th", "New Year", "Summer party"];

/** mulberry32: small, fast, deterministic. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random-looking v4 id from the seeded generator. Real ids are random, and the model is shown each wine by the
 * shortest unique prefix of its id (6 characters for random ids): counted ids would make every ref 32 characters
 * long and the prompt larger than it is in production.
 */
const uuid = (pick: () => number) => {
  const hex = Array.from({ length: 32 }, () => Math.floor(pick() * 16).toString(16)).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
};

/** A researched profile of the exact wine, as the household's `vintage_insights` row would hold it. */
function profileFor(style: Style, year: number | null, pick: () => number): InsightOutput {
  const red = style.type === "red";
  const serving =
    style.type === "sparkling"
      ? { minC: 7, maxC: 9 }
      : style.type === "white" || style.type === "rose"
        ? { minC: 9, maxC: 12 }
        : style.type === "dessert"
          ? { minC: 8, maxC: 10 }
          : style.type === "fortified"
            ? { minC: 12, maxC: 16 }
            : { minC: 16, maxC: 18 };
  const from = (year ?? 2020) + (red ? 4 : 1);
  return {
    summary: "Generated benchmark profile.",
    style: "",
    grapes: [],
    tasting: "",
    serving,
    decantMinutes: red ? [30, 60, 90][Math.floor(pick() * 3)]! : 0,
    abvPercent: red ? 14 : 12.5,
    drinkWindow: { from, until: from + (red ? 12 : 5) },
    pairings: [],
    aging: "",
    structure: {
      body: 1 + Math.floor(pick() * 5),
      tannin: red ? 2 + Math.floor(pick() * 4) : 1,
      sweetness: style.type === "dessert" || style.type === "fortified" ? 5 : 1,
      acidity: 2 + Math.floor(pick() * 4),
    },
    flavors: [],
    pairingKinds: [],
    version: PROFILE_VERSION,
    value: null,
    confidence: "high",
    evidence: "exact_wine",
    researched: true,
    sources: [{ name: "Benchmark", url: "https://www.example.com/wine" }],
  };
}

export interface BenchCellar {
  wines: number;
  rows: InventoryRow[];
  view: CellarView;
  /** The household's profiles, by vintage (about a third of the wines). */
  profiles: ReadonlyMap<string, InsightOutput>;
  favorites: ReadonlySet<string>;
  scores: ReadonlyArray<{ vintageId: string; score: number }>;
  /** The anchors' items, in ANCHORS order. */
  anchors: readonly CellarItem[];
}

/** A cellar of `wines` distinct vintages (at least the three anchors), the same for the same size every time. */
export function benchCellar(wines: number): BenchCellar {
  const pick = rng(0x5eed + wines);
  const rows: InventoryRow[] = [];
  const profiles = new Map<string, InsightOutput>();
  const favorites = new Set<string>();
  const scores: Array<{ vintageId: string; score: number }> = [];
  const reserved = new Map<string, Reservation>();
  const ids = rng(0x1d5 + wines);
  const anchorIds: string[] = [];
  for (let n = 0; n < Math.max(3, wines); n++) {
    const anchor = n < ANCHORS.length ? ANCHORS[n]! : null;
    const style = anchor
      ? STYLES.find((s) => s.name === anchor.style)!
      : STYLES[Math.floor(pick() * STYLES.length)]!;
    const producer = anchor ? anchor.producer : PRODUCERS[Math.floor(pick() * PRODUCERS.length)]!;
    // A spread of vintages around the style's usual one: young, ready and a few old bottles.
    const year = anchor
      ? anchor.year
      : style.year === null
        ? pick() < 0.85
          ? null
          : 2012 + Math.floor(pick() * 6)
        : Math.min(2025, style.year - 6 + Math.floor(pick() * 10));
    const vintageId = uuid(ids);
    const wineId = uuid(ids);
    if (anchor) anchorIds.push(vintageId);
    const count = anchor ? 6 : 1 + Math.floor(Math.pow(pick(), 2.2) * 12);
    const aiWindow =
      pick() < 0.25 && year !== null
        ? { from: year + 2, until: year + (style.type === "red" ? 15 : 6) }
        : null;
    for (let b = 0; b < count; b++) {
      const placed = pick() < 0.85;
      rows.push({
        bottleId: uuid(ids),
        vintageId,
        wineId,
        producer,
        wineName: style.name,
        type: style.type,
        year,
        region: pick() < 0.04 ? null : style.region,
        appellation: style.appellation,
        countryCode: style.countryCode,
        locationId: placed ? PLACE_IDS[(n + (b > 3 ? 1 : 0)) % PLACES.length]! : null,
        locationLabel: placed ? PLACES[(n + (b > 3 ? 1 : 0)) % PLACES.length]! : null,
        row: placed ? 1 + (b % 6) : null,
        col: placed ? 1 + (n % 8) : null,
        priceCents: style.euros * 100,
        currency: "EUR",
        addedAt: new Date(Date.UTC(2020, 0, 1) + n * 3_600_000 * 7).toISOString(),
        image: null,
        aiWindow,
      });
    }
    if (anchor || pick() < 0.33) profiles.set(vintageId, profileFor(style, year, pick));
    if (pick() < 0.2) scores.push({ vintageId, score: 5 + Math.floor(pick() * 5) });
    if (pick() < 0.05) favorites.add(wineId);
    if (!anchor && pick() < 0.08)
      reserved.set(vintageId, {
        count: Math.max(1, Math.floor(count * pick())),
        title: OCCASIONS[Math.floor(pick() * OCCASIONS.length)]!,
        on: pick() < 0.5 ? "2026-12-24" : null,
      });
  }
  // One anchor reserved in part, so `quantities` and `annotate` have a reservation to count.
  reserved.set(anchorIds[1]!, { count: 2, title: "Anniversary", on: "2026-12-12" });
  const base = aggregateInventory(rows, favorites, scores, NOW);
  const items = base.items.map((i): CellarItem => ({
    ...i,
    reserved: reserved.get(i.vintageId) ?? null,
  }));
  const byId = new Map(items.map((i) => [i.vintageId, i]));
  return {
    wines: items.length,
    rows,
    view: { ...base, items },
    profiles,
    favorites,
    scores,
    anchors: anchorIds.map((id) => byId.get(id)!),
  };
}
