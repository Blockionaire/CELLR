import "server-only";
import type { Db } from "@/server/db/clients";

export interface Confirmation {
  wineId: string;
  year: number | null;
}

export interface ScanRepository {
  /**
   * What this household confirmed an identical photo (same fingerprint) to be: one row per distinct wine and
   * year. Null when the cache is not available (its database step has not been taken yet).
   */
  recall(householdId: string, fingerprint: string): Promise<Confirmation[] | null>;
}

/** Before 20261029000021 the function does not exist. */
const missing = (error: { code?: string }) => error.code === "PGRST202" || error.code === "42883";

/** Read as the signed-in person: the database function runs under their own row-level security. */
export function createScanRepository(db: Db): ScanRepository {
  return {
    async recall(householdId, fingerprint) {
      const { data, error } = await db.rpc("recall_confirmed_scan", {
        p_household_id: householdId,
        p_fingerprint: fingerprint,
      });
      if (error) {
        if (missing(error)) return null;
        throw error;
      }
      return (data ?? []).map((r) => ({ wineId: r.wine_id, year: r.year }));
    },
  };
}
