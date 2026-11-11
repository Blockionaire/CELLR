import "server-only";
import {
  publicSearchHits,
  searchableQuery,
  type CatalogSearchQuery,
  type CatalogSearchResponse,
} from "@cellr/domain";
import type { CatalogSearchRepository } from "./search-repository";

export interface CatalogSearchDeps {
  repo: CatalogSearchRepository;
  /** The active household (the search is always for the caller's own household). */
  householdId: () => Promise<string>;
  /** Counts this search against the person's budget; throws RATE_LIMITED when spent. */
  spend: () => Promise<void>;
}

/**
 * Wine-name search for autocomplete (Sprint 004A). Only the database is searched: no external provider is ever
 * called per keystroke. A query too short to be a search costs nothing (no budget, no database call).
 */
export function createCatalogSearchService({ repo, householdId, spend }: CatalogSearchDeps) {
  return {
    async search(input: CatalogSearchQuery): Promise<CatalogSearchResponse> {
      const query = searchableQuery(input.q);
      if (query === null) return { query: null, results: [], available: true };
      await spend();
      const rows = await repo.search({
        householdId: await householdId(),
        query,
        type: input.type ?? null,
        country: input.country ?? null,
        region: input.region ?? null,
        limit: input.limit,
      });
      if (rows === null) return { query, results: [], available: false };
      return { query, results: publicSearchHits(rows), available: true };
    },
  };
}

export type CatalogSearchService = ReturnType<typeof createCatalogSearchService>;
