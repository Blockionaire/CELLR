import "server-only";
import {
  CATALOG_SEARCH,
  labelPhrases,
  publicSearchHits,
  resolverQuery,
  resolveWine,
  searchableQuery,
  suggestRecordsForReading,
  WINE_TYPES,
  type CatalogSearchRow,
  type LabelFacts,
  type LabelTextCandidate,
  type RecordSuggestion,
  type ResolveOutcome,
  type WineSummary,
  type WineType,
} from "@cellr/domain";
import type { CatalogSearchArgs } from "./search-repository";

export interface WineResolverDeps {
  /** The household's own wines. Bounded by the household, never by the size of the catalogue. */
  ownWines: (householdId: string) => Promise<WineSummary[]>;
  /**
   * The wines this household can see whose producer or name is exactly one of these phrases, and its own wines
   * verifiably linked to them (`find_wines_by_label_text`: indexed equality, at most 40). Null = not deployed.
   */
  findByText: (householdId: string, phrases: string[]) => Promise<LabelTextCandidate[] | null>;
  /** Ranked rows of `catalog_search` for this household (at most 20). Null = not deployed. */
  search: (args: CatalogSearchArgs) => Promise<CatalogSearchRow[] | null>;
}

/** A CELLR wine among the search rows. A provider record is never a candidate for an identity: it is dropped. */
function wineOfRow(row: CatalogSearchRow): WineSummary | null {
  if (row.result_kind !== "wine" || !row.wine_id) return null;
  if (!(WINE_TYPES as readonly string[]).includes(row.wine_type ?? "")) return null;
  // only the catalogue's own wines are catalogue wines, and only they carry a verified alias
  const catalog = row.verified === true && row.source !== "household";
  return {
    id: row.wine_id,
    producer: row.producer,
    name: row.name,
    type: row.wine_type as WineType,
    countryCode: row.country_code,
    region: row.region,
    ...(catalog ? { catalog: true, aliases: row.matched_alias ? [row.matched_alias] : [] } : {}),
  };
}

/**
 * THE SERVER SIDE OF "WHICH WINE IS THIS?" (Wine Intelligence WI-03). Collects a bounded set of candidates for what
 * was read off a label, and lets the domain's `resolveWine` decide by the unchanged identity rules:
 *   1. the household's own wines (all of them: a household's wine is never passed over);
 *   2. the wines of exactly that producer, and wines linked to them (indexed equality lookups);
 *   3. the best ranked hits of the catalogue search for "producer name" (typos, word order, aliases).
 * Instead of every wine the household can see, which grows with the catalogue.
 *
 * It only reads. It never calls a model, never spends a budget, and never makes a provider's record a candidate: the
 * identity decision is over CELLR wines only. Records the same search already offered this person (sources in the
 * "public" scope; none today) are ranked apart, in `records`, as suggestions for a wine nobody in CELLR has added yet
 * (Sprint 004B, `suggestRecordsForReading`). They never change the outcome and are never an identity.
 * `null` means the lookups are not available in this database; the caller then matches as it did before.
 */
export function createWineResolver(deps: WineResolverDeps) {
  return {
    async resolve(
      householdId: string,
      facts: LabelFacts,
    ): Promise<(ResolveOutcome & { records: RecordSuggestion[] }) | null> {
      const text = resolverQuery(facts);
      if (text === null) return { ...resolveWine(facts, []), records: [] };
      const query = searchableQuery(text);
      const phrases = labelPhrases([facts.producer, facts.name].filter(Boolean).join("\n"));
      const [own, byText, rows] = await Promise.all([
        deps.ownWines(householdId),
        phrases.length > 0 ? deps.findByText(householdId, phrases) : Promise.resolve([]),
        query !== null
          ? deps.search({
              householdId,
              query,
              type: null,
              country: null,
              region: null,
              limit: CATALOG_SEARCH.maxLimit,
            })
          : Promise.resolve([]),
      ]);
      if (byText === null || rows === null) return null;

      // One wine once. The equality lookup's version wins: it carries every verified alias of a catalogue wine.
      const candidates = new Map<string, WineSummary>();
      for (const row of rows) {
        const wine = wineOfRow(row);
        if (wine) candidates.set(wine.id, wine);
      }
      for (const wine of own) candidates.set(wine.id, wine);
      for (const c of byText) candidates.set(c.wine.id, c.wine);
      // records: only what the people's search returned, and only public sources again (fail closed)
      const records = suggestRecordsForReading(facts, publicSearchHits(rows));
      return { ...resolveWine(facts, [...candidates.values()]), records };
    },
  };
}

export type WineResolver = ReturnType<typeof createWineResolver>;
