import type { CellarItem } from "./cellar";
import { cellarDigest, type BuySuggestion, type CellarDigest } from "./sommelier";
import type { Budget } from "./sommelier";
import { checkAnswerClaims } from "./sommelier-check";

/**
 * A small invented cellar for the answer-check tests (no real household's data): two vintages of one wine, a
 * producer with three wines, an NV sparkling, and names that hold numbers.
 */
let n = 0;
export const cellarItem = (over: Partial<CellarItem> = {}): CellarItem => {
  n += 1;
  return {
    vintageId: `${(0xabc000 + n).toString(16)}00-0000-4000-8000-000000000000`,
    wineId: `w${n}`,
    producer: `Producer ${n}`,
    wineName: `Wine ${n}`,
    type: "red",
    year: 2015,
    region: "Bordeaux",
    countryCode: "FR",
    count: 2,
    places: ["Wine fridge"],
    unplaced: 0,
    image: null,
    favorite: false,
    rating: null,
    drink: {
      source: "estimate",
      reliable: false,
      uncertain: false,
      phase: "peak",
      from: 2014,
      until: 2030,
      urgency: 5,
      yearsUntilOpen: null,
      yearsLeft: 4,
      position: 0.5,
    },
    ...over,
  };
};

export const musar18 = cellarItem({
  wineId: "musar",
  producer: "Château Musar",
  wineName: "Rouge",
  year: 2018,
  region: "Bekaa Valley",
  countryCode: "LB",
  count: 3,
  reserved: { count: 1, title: "Anniversary", on: null },
});
export const musar15 = cellarItem({
  wineId: "musar",
  producer: "Château Musar",
  wineName: "Rouge",
  year: 2015,
  region: "Bekaa Valley",
  countryCode: "LB",
  count: 2,
});
export const albe = cellarItem({
  producer: "G.D. Vajra",
  wineName: "Barolo Albe",
  year: 2016,
  region: "Piedmont",
  appellation: "Barolo",
  countryCode: "IT",
  count: 6,
});
export const langhe = cellarItem({
  producer: "G.D. Vajra",
  wineName: "Langhe Nebbiolo",
  year: 2021,
  region: "Piedmont",
  countryCode: "IT",
  count: 4,
});
export const bollinger = cellarItem({
  producer: "Bollinger",
  wineName: "Special Cuvée",
  year: null,
  type: "sparkling",
  region: "Champagne",
  count: 1,
});
export const pavillon = cellarItem({
  producer: "Château Margaux",
  wineName: "Pavillon Rouge",
  year: 2015,
  count: 2,
});
export const grandVin = cellarItem({
  producer: "Château Margaux",
  wineName: "Château Margaux",
  year: 2010,
  count: 1,
});
export const cepages = cellarItem({
  producer: "Mas des Sept",
  wineName: "Les 7 Cépages",
  year: 2020,
  region: "Languedoc",
  count: 4,
});
export const cuvee1522 = cellarItem({
  producer: "Domaine Lumen",
  wineName: "Cuvée 1522",
  year: 2019,
  type: "white",
  region: "Loire",
  count: 2,
});

export const CELLAR = [
  musar18,
  musar15,
  albe,
  langhe,
  bollinger,
  pavillon,
  grandVin,
  cepages,
  cuvee1522,
];
export const DIGEST: CellarDigest = cellarDigest(CELLAR, "");
const REFS = new Map([...DIGEST.refs].map(([ref, item]) => [item.vintageId, ref]));
/** The ref the model was shown for a wine, in double square brackets. */
export const ref = (item: CellarItem) => `[[${REFS.get(item.vintageId)}]]`;
export const NOW = new Date("2026-11-23T12:00:00Z");

/** The check with this cellar, as the service will call it. */
export const check = (
  text: string,
  over: {
    buy?: BuySuggestion[];
    budget?: Budget | null;
    items?: CellarItem[];
    digest?: CellarDigest;
    facts?: string | null;
  } = {},
) =>
  checkAnswerClaims({
    text,
    bottles: [],
    buy: over.buy ?? [],
    digest: over.digest ?? DIGEST,
    items: over.items ?? CELLAR,
    budget: over.budget ?? null,
    facts: over.facts ?? null,
    now: NOW,
  });
