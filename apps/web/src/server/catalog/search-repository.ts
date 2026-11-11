import "server-only";
import type { CatalogSearchRow } from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { mapDbError } from "@/server/db/errors";

export interface CatalogSearchArgs {
  householdId: string;
  query: string;
  type: string | null;
  country: string | null;
  region: string | null;
  limit: number;
}

export interface CatalogSearchRepository {
  /** Ranked rows from `public.catalog_search` (as the person, under RLS), or null before that migration runs. */
  search(args: CatalogSearchArgs): Promise<CatalogSearchRow[] | null>;
}

export function createCatalogSearchRepository(db: Db): CatalogSearchRepository {
  return {
    async search({ householdId, query, type, country, region, limit }) {
      const { data, error } = await db.rpc("catalog_search", {
        p_household_id: householdId,
        p_query: query,
        p_type: type as string,
        p_country: country as string,
        p_region: region as string,
        p_limit: limit,
      });
      // Before 20261114000037 the function does not exist.
      if (error && (error.code === "PGRST202" || error.code === "42883")) return null;
      if (error) throw mapDbError(error);
      return (data ?? []) as CatalogSearchRow[];
    },
  };
}
