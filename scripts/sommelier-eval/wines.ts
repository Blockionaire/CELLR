import type { WineType } from "@cellr/domain";

/**
 * THE BENCHMARK'S WINES. Thirty archetypes a wine drinker recognises, each standing for a style. The producers are
 * invented ("Domaine Exemple"); the appellations, regions and typical prices are real-world typical, not quotes.
 * Reference answers (dishes.ts) name these keys, so a scenario's truth does not depend on any engine's scoring.
 *
 * `structure` is the reference structure on the app's 1–5 scales (as a wine profile would state it for the exact
 * wine). An engine only sees it when a scenario's cellar says the wine has a researched profile.
 */
export interface ArchetypeWine {
  key: string;
  producer: string;
  name: string;
  type: WineType;
  year: number | null;
  region: string;
  appellation: string;
  countryCode: string;
  grapes: readonly string[];
  /** Typical price per bottle, in euro cents. */
  priceCents: number;
  structure: { body: number; tannin: number; sweetness: number; acidity: number };
}

const w = (
  key: string,
  name: string,
  type: WineType,
  year: number | null,
  region: string,
  appellation: string,
  countryCode: string,
  grapes: readonly string[],
  euros: number,
  [body, tannin, sweetness, acidity]: readonly [number, number, number, number],
): ArchetypeWine => ({
  key,
  producer: "Domaine Exemple",
  name,
  type,
  year,
  region,
  appellation,
  countryCode,
  grapes,
  priceCents: euros * 100,
  structure: { body, tannin, sweetness, acidity },
});

// prettier-ignore
export const WINES: readonly ArchetypeWine[] = [
  // Whites, light to rich
  w("muscadet", "Muscadet Sèvre et Maine sur lie", "white", 2023, "Loire", "Muscadet Sèvre et Maine", "FR", ["Melon de Bourgogne"], 12, [1, 1, 1, 5]),
  w("chablis", "Chablis", "white", 2022, "Burgundy", "Chablis", "FR", ["Chardonnay"], 22, [2, 1, 1, 5]),
  w("sancerre", "Sancerre", "white", 2023, "Loire", "Sancerre", "FR", ["Sauvignon Blanc"], 24, [2, 1, 1, 5]),
  w("albarino", "Albariño", "white", 2023, "Rías Baixas", "Rías Baixas", "ES", ["Albariño"], 16, [2, 1, 1, 4]),
  w("gruner", "Grüner Veltliner Federspiel", "white", 2022, "Wachau", "Wachau", "AT", ["Grüner Veltliner"], 19, [2, 1, 1, 4]),
  w("riesling-kabinett", "Riesling Kabinett", "white", 2022, "Mosel", "Mosel", "DE", ["Riesling"], 18, [1, 1, 3, 5]),
  w("gewurztraminer", "Gewurztraminer", "white", 2021, "Alsace", "Alsace", "FR", ["Gewürztraminer"], 20, [4, 1, 2, 2]),
  w("condrieu", "Condrieu", "white", 2021, "Rhône", "Condrieu", "FR", ["Viognier"], 45, [4, 1, 1, 2]),
  w("meursault", "Meursault", "white", 2020, "Burgundy", "Meursault", "FR", ["Chardonnay"], 55, [4, 1, 1, 3]),
  // Sparkling and rosé
  w("champagne", "Champagne Brut", "sparkling", null, "Champagne", "Champagne", "FR", ["Chardonnay", "Pinot Noir"], 40, [2, 1, 1, 5]),
  w("cava", "Cava Brut Nature", "sparkling", null, "Penedès", "Cava", "ES", ["Macabeo", "Xarel·lo", "Parellada"], 12, [2, 1, 1, 4]),
  w("provence-rose", "Côtes de Provence Rosé", "rose", 2024, "Provence", "Côtes de Provence", "FR", ["Grenache", "Cinsault"], 14, [2, 1, 1, 4]),
  // Reds, light to powerful
  w("beaujolais", "Fleurie", "red", 2022, "Beaujolais", "Fleurie", "FR", ["Gamay"], 16, [2, 2, 1, 4]),
  w("bourgogne-pinot", "Gevrey-Chambertin", "red", 2019, "Burgundy", "Gevrey-Chambertin", "FR", ["Pinot Noir"], 60, [3, 3, 1, 4]),
  w("chianti", "Chianti Classico", "red", 2020, "Tuscany", "Chianti Classico", "IT", ["Sangiovese"], 20, [3, 4, 1, 4]),
  w("rioja-reserva", "Rioja Reserva", "red", 2017, "Rioja", "Rioja", "ES", ["Tempranillo"], 22, [4, 3, 1, 3]),
  w("crozes", "Crozes-Hermitage", "red", 2020, "Rhône", "Crozes-Hermitage", "FR", ["Syrah"], 20, [4, 4, 1, 3]),
  w("chateauneuf", "Châteauneuf-du-Pape", "red", 2018, "Rhône", "Châteauneuf-du-Pape", "FR", ["Grenache", "Syrah", "Mourvèdre"], 40, [5, 3, 1, 2]),
  w("malbec", "Malbec", "red", 2021, "Mendoza", "Mendoza", "AR", ["Malbec"], 15, [5, 4, 1, 3]),
  w("barolo", "Barolo", "red", 2016, "Piedmont", "Barolo", "IT", ["Nebbiolo"], 55, [4, 5, 1, 5]),
  w("pauillac", "Pauillac", "red", 2015, "Bordeaux", "Pauillac", "FR", ["Cabernet Sauvignon", "Merlot"], 70, [5, 5, 1, 3]),
  w("napa-cab", "Cabernet Sauvignon", "red", 2018, "Napa Valley", "Napa Valley", "US", ["Cabernet Sauvignon"], 65, [5, 4, 1, 3]),
  w("amarone", "Amarone della Valpolicella", "red", 2017, "Veneto", "Amarone della Valpolicella", "IT", ["Corvina", "Rondinella"], 50, [5, 4, 2, 3]),
  // Sweet and fortified
  w("moscato", "Moscato d'Asti", "dessert", 2023, "Piedmont", "Moscato d'Asti", "IT", ["Moscato Bianco"], 12, [1, 1, 5, 3]),
  w("sauternes", "Sauternes", "dessert", 2015, "Bordeaux", "Sauternes", "FR", ["Sémillon", "Sauvignon Blanc"], 35, [5, 1, 5, 4]),
  w("tawny-port", "10 Year Old Tawny Port", "fortified", null, "Douro", "Porto", "PT", ["Touriga Nacional"], 25, [5, 2, 5, 3]),
  w("vintage-port", "Vintage Port", "fortified", 2011, "Douro", "Porto", "PT", ["Touriga Nacional"], 60, [5, 4, 5, 3]),
  w("fino", "Fino Sherry", "fortified", null, "Jerez", "Jerez-Xérès-Sherry", "ES", ["Palomino"], 12, [2, 1, 1, 3]),
  // Two that test nuance
  w("orange", "Ribolla Gialla macerata", "orange", 2021, "Friuli", "Collio", "IT", ["Ribolla Gialla"], 24, [3, 3, 1, 4]),
  w("pinot-gris", "Pinot Gris", "white", 2022, "Alsace", "Alsace", "FR", ["Pinot Gris"], 18, [3, 1, 2, 3]),
];

export type WineKey = (typeof WINES)[number]["key"];
export const WINE_KEYS: ReadonlySet<string> = new Set(WINES.map((x) => x.key));
export const wineByKey = (key: string): ArchetypeWine => {
  const found = WINES.find((x) => x.key === key);
  if (!found) throw new Error(`unknown benchmark wine: ${key}`);
  return found;
};

/** Named cellars a scenario can use. `all` is every archetype; the others leave things out on purpose. */
export const CELLARS: Readonly<Record<string, readonly string[]>> = {
  all: WINES.map((x) => x.key),
  empty: [],
  "reds-only": WINES.filter((x) => x.type === "red").map((x) => x.key),
  "big-reds": ["malbec", "pauillac", "napa-cab", "amarone", "chateauneuf", "barolo"],
  "light-whites": ["muscadet", "chablis", "sancerre", "albarino", "gruner"],
  "whites-and-bubbles": [
    "muscadet",
    "chablis",
    "sancerre",
    "albarino",
    "gruner",
    "meursault",
    "condrieu",
    "champagne",
    "cava",
  ],
  "dry-only": WINES.filter((x) => x.structure.sweetness <= 1).map((x) => x.key),
  "sweet-only": ["moscato", "sauternes", "tawny-port", "vintage-port"],
  everyday: [
    "muscadet",
    "albarino",
    "cava",
    "provence-rose",
    "beaujolais",
    "chianti",
    "rioja-reserva",
    "malbec",
  ],
  "one-red": ["rioja-reserva"],
  "one-white": ["sancerre"],
};
