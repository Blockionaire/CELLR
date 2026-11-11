import { z } from "zod";
import { normalizeText, WINE_TYPES, type WineType } from "./cellar";

/**
 * WINE-NAME SEARCH (Sprint 004A). One server-side search over the household's own wines, the shared catalogue and
 * the records of external providers that are enabled for search. The database ranks and bounds the results
 * (`public.catalog_search`); this module holds the contract and the rules that must hold whatever the database
 * returns: a result is only ever "verified" when it is a canonical CELLR wine, and a fuzzy or provider result is
 * never an identity on its own — the person confirms it.
 */

export const CATALOG_SEARCH = {
  /** Fewer normalised letters than this is not a search (no database call). */
  minChars: 2,
  /** The database cuts the normalised query to this many characters and words. */
  maxChars: 80,
  maxWords: 8,
  defaultLimit: 8,
  maxLimit: 20,
  /** What a client may send before it is refused outright (the rest is cut, not refused). */
  maxInput: 200,
} as const;

export const CatalogSearchQuerySchema = z.object({
  q: z.string().max(CATALOG_SEARCH.maxInput),
  type: z.enum(WINE_TYPES).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  region: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CATALOG_SEARCH.maxLimit)
    .default(CATALOG_SEARCH.defaultLimit),
});
export type CatalogSearchQuery = z.infer<typeof CatalogSearchQuerySchema>;

/** The query as the database will search it, or null when it is too short to be a search. */
export function searchableQuery(input: string): string | null {
  const words = normalizeText(input.slice(0, CATALOG_SEARCH.maxInput))
    .split(" ")
    .filter(Boolean)
    .slice(0, CATALOG_SEARCH.maxWords);
  const q = words.join(" ").slice(0, CATALOG_SEARCH.maxChars).trim();
  return q.length >= CATALOG_SEARCH.minChars ? q : null;
}

export const SEARCH_SOURCES = ["owned", "household", "catalog", "provider"] as const;
/** owned: the household has bottles of it; household: its own wine; catalog: canonical; provider: external record. */
export type SearchSource = (typeof SEARCH_SOURCES)[number];
export const SEARCH_MATCHES = ["exact", "alias", "prefix", "fuzzy"] as const;
export type SearchMatch = (typeof SEARCH_MATCHES)[number];

export interface CatalogSearchHit {
  /** "wine": a CELLR wine (the household's own or canonical); "record": an external provider's record. */
  kind: "wine" | "record";
  wineId: string | null;
  recordId: string | null;
  producer: string;
  name: string;
  /** The verified alias that matched, when the match was on an alias. */
  matchedAlias: string | null;
  type: WineType | null;
  countryCode: string | null;
  region: string | null;
  source: SearchSource;
  /** Only a canonical CELLR wine is verified. Never a household's own wine, never a provider record. */
  verified: boolean;
  match: SearchMatch;
  /** Bottles of it in the household's cellar now. */
  bottles: number;
  /**
   * For a provider record: whose it is, the credit its licence requires, the licence link, whether CELLR modified
   * the record, and where the provider is shown ("pilot": evaluation only — never presented as licensed data).
   */
  provider: {
    id: string;
    name: string;
    license: string;
    licenseUrl: string | null;
    attribution: string | null;
    scope: "pilot" | "public";
    modified: boolean;
  } | null;
  /** For a provider record: the vintages it lists (empty when it lists none). */
  vintages: number[] | null;
}

export interface CatalogSearchResponse {
  /** The query as searched (normalised), or null when it was too short. */
  query: string | null;
  results: CatalogSearchHit[];
  /** False when the search is not available (the database step is not deployed yet): the person types the wine. */
  available: boolean;
}

/** A row of `public.catalog_search`, as the database returns it. */
export interface CatalogSearchRow {
  result_kind: string;
  wine_id: string | null;
  record_id: string | null;
  producer: string;
  name: string;
  matched_alias: string | null;
  wine_type: string | null;
  country_code: string | null;
  region: string | null;
  source: string;
  verified: boolean;
  match: string;
  score: number;
  bottles: number;
  provider_id: string | null;
  provider_name: string | null;
  attribution: string | null;
  license: string | null;
  license_url: string | null;
  provider_scope: string | null;
  modified: boolean | null;
  vintages: number[] | null;
}

const oneOf = <T extends string>(values: readonly T[], v: string, fallback: T): T =>
  (values as readonly string[]).includes(v) ? (v as T) : fallback;

/**
 * A database row as a result, with the identity rules enforced here as well: a record is never verified, a wine is
 * verified only when it is the catalogue's, and an unknown match kind is treated as the weakest (fuzzy).
 */
export function toSearchHit(row: CatalogSearchRow): CatalogSearchHit {
  const kind = row.result_kind === "record" ? "record" : "wine";
  const source: SearchSource =
    kind === "record"
      ? "provider"
      : oneOf(["owned", "household", "catalog"] as const, row.source, "household");
  const type =
    row.wine_type && (WINE_TYPES as readonly string[]).includes(row.wine_type)
      ? (row.wine_type as WineType)
      : null;
  return {
    kind,
    wineId: kind === "wine" ? row.wine_id : null,
    recordId: kind === "record" ? row.record_id : null,
    producer: row.producer,
    name: row.name,
    matchedAlias: row.matched_alias,
    type,
    countryCode: row.country_code,
    region: row.region,
    source,
    // an owned wine can be a catalogue wine too: the database says so; a record or a household wine never is
    verified: kind === "wine" && row.verified === true && source !== "household",
    match: oneOf(SEARCH_MATCHES, row.match, "fuzzy"),
    bottles: Math.max(0, Math.trunc(row.bottles ?? 0)),
    provider:
      kind === "record" && row.provider_id
        ? {
            id: row.provider_id,
            name: row.provider_name ?? row.provider_id,
            license: row.license ?? "",
            licenseUrl: row.license_url,
            attribution: row.attribution,
            // anything but an explicit "public" is treated as the evaluation scope
            scope: row.provider_scope === "public" ? "public" : "pilot",
            modified: row.modified !== false,
          }
        : null,
    vintages: kind === "record" ? (row.vintages ?? []) : null,
  };
}

/**
 * Whether choosing this result may use it as the wine's identity without asking again: only a verified catalogue
 * wine matched on its name or a verified alias, or the household's own wine typed exactly. A similar name (fuzzy), a
 * prefix the person has not finished, and every provider record need the person's explicit confirmation — and a
 * provider record never becomes a canonical wine by being chosen.
 */
export function needsConfirmation(hit: CatalogSearchHit): boolean {
  if (hit.kind === "record") return true;
  if (hit.match === "fuzzy" || hit.match === "prefix") return true;
  return !hit.verified && hit.source !== "household" && hit.source !== "owned";
}
