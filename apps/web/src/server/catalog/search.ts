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
 * The caller went away before the answer was ready (the browser cancelled the request because the person typed on).
 * Not an error: nobody is waiting for an answer, so the route sends none (see the route's handler).
 */
export class SearchCancelled extends Error {
  constructor() {
    super("search cancelled by the caller");
    this.name = "SearchCancelled";
  }
}

/**
 * Wine-name search for autocomplete (Sprint 004A). Only the database is searched: no external provider is ever
 * called per keystroke. A query too short to be a search costs nothing (no budget, no database call).
 *
 * `signal` is the request's own: it aborts when the caller disconnects. A request cancelled while typing is otherwise
 * carried out to the end (a statement already running in the database is finished whatever the caller does), so the
 * steps that have not started yet are skipped: no budget is spent once it is gone, and the search itself is not
 * started. What is answered to a caller that is still there is unchanged.
 */
export function createCatalogSearchService({ repo, householdId, spend }: CatalogSearchDeps) {
  return {
    async search(input: CatalogSearchQuery, signal?: AbortSignal): Promise<CatalogSearchResponse> {
      const query = searchableQuery(input.q);
      if (query === null) return { query: null, results: [], available: true };
      const stillWanted = () => {
        if (signal?.aborted) throw new SearchCancelled();
      };
      stillWanted();
      await spend();
      stillWanted();
      const household = await householdId();
      stillWanted();
      const rows = await repo
        .search(
          {
            householdId: household,
            query,
            type: input.type ?? null,
            country: input.country ?? null,
            region: input.region ?? null,
            limit: input.limit,
          },
          signal,
        )
        .catch((error: unknown) => {
          stillWanted(); // a request the caller cancelled fails by design: that is not a database error
          throw error;
        });
      stillWanted();
      if (rows === null) return { query, results: [], available: false };
      return { query, results: publicSearchHits(rows), available: true };
    },
  };
}

export type CatalogSearchService = ReturnType<typeof createCatalogSearchService>;
