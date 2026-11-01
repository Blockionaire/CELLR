import "server-only";
import type { LabelTextCandidate, WineType } from "@cellr/domain";
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
  /**
   * The wines this household can see (its own and the catalogue's) whose producer or name is one of these printed
   * phrases, plus its own wines verifiably linked to those (Sprint S). Bounded by the database. Null when the lookup
   * is not available (its database step has not been taken yet).
   */
  findByText(householdId: string, phrases: string[]): Promise<LabelTextCandidate[] | null>;
}

/** Before 20261029000021 (recall) or 20261108000031 (findByText) the function does not exist. */
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

    async findByText(householdId, phrases) {
      const { data, error } = await db.rpc("find_wines_by_label_text", {
        p_household_id: householdId,
        p_phrases: phrases,
      });
      if (error) {
        if (missing(error)) return null;
        throw error;
      }
      return (data ?? []).map((r) => ({
        wine: {
          id: r.wine_id,
          producer: r.producer,
          name: r.name,
          type: r.wine_type as WineType,
          countryCode: r.country_code ?? null,
          region: r.region ?? null,
          ...(r.canonical ? { catalog: true, aliases: r.aliases ?? [] } : {}),
        },
        linkedTo: r.linked_to ?? null,
      }));
    },
  };
}
