import "server-only";
import type { BottleStatus, WineType } from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { isMissingTable, mapDbError } from "@/server/db/errors";
import { allRows } from "@/server/db/paging";
import type { ExportBottleRow, ExportRepository, ExportTastingRow } from "./types";

const WINE_JOIN =
  "wine_vintages!inner(year, wines!inner(name, wine_type, region, appellation, country_code, producers!inner(name)))";

/** Everything is read, page by page (the data API cuts any one answer at 1000 rows), as the person themselves. */
export function createExportRepository(db: Db): ExportRepository {
  return {
    async bottles(householdId): Promise<ExportBottleRow[]> {
      const { data, error } = await allRows((from, to) =>
        db
          .from("bottles")
          .select(
            `status, loc_row, loc_col, format_ml, purchase_price_cents, currency, purchased_at, purchased_from, notes, created_at, opened_at, cellar_locations(label), ${WINE_JOIN}`,
          )
          .eq("household_id", householdId)
          .order("created_at")
          .order("id")
          .range(from, to),
      );
      if (error) throw mapDbError(error);
      return data.map((b) => ({
        producer: b.wine_vintages.wines.producers.name,
        wine: b.wine_vintages.wines.name,
        year: b.wine_vintages.year,
        type: b.wine_vintages.wines.wine_type as WineType,
        country: b.wine_vintages.wines.country_code,
        region: b.wine_vintages.wines.region,
        appellation: b.wine_vintages.wines.appellation,
        status: b.status as BottleStatus,
        place: b.cellar_locations?.label ?? null,
        row: b.loc_row,
        col: b.loc_col,
        sizeMl: b.format_ml,
        priceCents: b.purchase_price_cents,
        currency: b.currency,
        purchasedAt: b.purchased_at,
        purchasedFrom: b.purchased_from,
        notes: b.notes,
        addedAt: b.created_at,
        openedAt: b.opened_at,
      }));
    },

    async tastings(householdId): Promise<ExportTastingRow[]> {
      const { data, error } = await allRows((from, to) =>
        db
          .from("tastings")
          .select(`score, descriptors, note, tasted_at, profiles(display_name), ${WINE_JOIN}`)
          .eq("household_id", householdId)
          .order("tasted_at")
          .order("id")
          .range(from, to),
      );
      if (error && isMissingTable(error)) return [];
      if (error) throw mapDbError(error);
      return data.map((t) => ({
        producer: t.wine_vintages.wines.producers.name,
        wine: t.wine_vintages.wines.name,
        year: t.wine_vintages.year,
        score: t.score,
        descriptors: t.descriptors,
        note: t.note,
        tastedAt: t.tasted_at,
        by: t.profiles?.display_name ?? null,
      }));
    },
  };
}
