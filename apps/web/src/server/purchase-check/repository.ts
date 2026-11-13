import "server-only";
import {
  WINE_TYPES,
  type CatalogWineFacts,
  type ProfileLanguage,
  type StoredProfile,
  type WineType,
} from "@cellr/domain";
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
  /**
   * What the curated catalogue records about one wine; null when it is not a catalogue wine (a household's own wine
   * has no verified facts to add) or cannot be seen.
   */
  getCatalogWine(wineId: string): Promise<CatalogWineFacts | null>;
  /**
   * The shared profiles of the vintages of one catalogue wine, in one language: at most 60, the most recently
   * researched first. A wine with more profiled vintages than that may miss an old one, which then simply counts as
   * "no profile of that vintage" (less is shown, never something wrong).
   * Public wine knowledge: no household, person, price or note is in them. Empty before that database step.
   */
  listSharedProfiles(wineId: string, language: ProfileLanguage): Promise<StoredProfile[]>;
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

    async getCatalogWine(wineId) {
      const { data, error } = await db
        .from("wines")
        .select(
          "id, status, wine_type, country_code, region, appellation, producers!inner(country_code, status), wine_grapes(grapes(name))",
        )
        .eq("id", wineId)
        .eq("status", "canonical")
        .is("owner_household_id", null)
        .maybeSingle();
      if (error) throw mapDbError(error);
      if (!data || data.producers.status !== "canonical") return null;
      return {
        id: data.id,
        type: (WINE_TYPES as readonly string[]).includes(data.wine_type)
          ? (data.wine_type as WineType)
          : null,
        countryCode: data.country_code ?? data.producers.country_code ?? null,
        region: data.region,
        appellation: data.appellation,
        grapes: (data.wine_grapes ?? []).flatMap((g) => (g.grapes?.name ? [g.grapes.name] : [])),
      };
    },

    async listSharedProfiles(wineId, language) {
      const { data, error } = await db
        .from("shared_wine_profiles")
        .select("output, generated_at, wine_vintages!inner(year, wine_id)")
        .eq("wine_vintages.wine_id", wineId)
        .eq("language", language)
        .order("generated_at", { ascending: false })
        .limit(60);
      // Before 20261030000022 the table does not exist: nothing is known, nothing fails.
      if (error && (error.code === "42P01" || error.code === "PGRST205")) return [];
      if (error) throw mapDbError(error);
      return (data ?? []).map((r) => ({
        year: r.wine_vintages.year,
        output: r.output,
        generatedAt: r.generated_at,
      }));
    },
  };
}
