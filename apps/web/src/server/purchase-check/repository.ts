import "server-only";
import type { Db } from "@/server/db/clients";
import { mapDbError } from "@/server/db/errors";

/** What the cellar list does not carry about a wine: its appellation, curated grapes and verified aliases. */
export interface WineTraitsRow {
  wineId: string;
  appellation: string | null;
  grapes: string[];
  aliases: string[];
  /** A wine of the shared, curated catalogue. */
  catalog: boolean;
}

export interface PurchaseCheckRepository {
  /** Of these wines (read under the person's own row-level security), what the comparison needs. */
  listWineTraits(wineIds: string[]): Promise<WineTraitsRow[]>;
}

export function createPurchaseCheckRepository(db: Db): PurchaseCheckRepository {
  return {
    async listWineTraits(wineIds) {
      const ids = [...new Set(wineIds)];
      const out: WineTraitsRow[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await db
          .from("wines")
          .select("id, status, appellation, wine_aliases(alias), wine_grapes(grapes(name))")
          .in("id", ids.slice(i, i + 100));
        if (error) throw mapDbError(error);
        for (const w of data)
          out.push({
            wineId: w.id,
            appellation: w.appellation,
            grapes: (w.wine_grapes ?? []).flatMap((g) => (g.grapes?.name ? [g.grapes.name] : [])),
            // Only catalogue wines carry verified aliases (as everywhere else in CELLR).
            aliases: w.status === "canonical" ? (w.wine_aliases ?? []).map((a) => a.alias) : [],
            catalog: w.status === "canonical",
          });
      }
      return out;
    },
  };
}
