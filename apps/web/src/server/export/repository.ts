import "server-only";
import type { BottleStatus, WineType } from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { isMissingTable, mapDbError } from "@/server/db/errors";
import { mapSmartCellarError } from "@/server/smart-cellar/repository";
import { allRows } from "@/server/db/paging";
import type { ExportBottleRow, ExportRepository, ExportTastingRow } from "./types";

/** One bottle row as the query below returns it. */
type BottleRecord = {
  status: string;
  loc_row: number | null;
  loc_col: number | null;
  loc_index?: number;
  format_ml: number;
  purchase_price_cents: number | null;
  currency: string | null;
  purchased_at: string | null;
  purchased_from: string | null;
  notes: string | null;
  created_at: string;
  opened_at: string | null;
  cellar_locations: { label: string } | null;
  wine_vintages: {
    year: number | null;
    wines: {
      name: string;
      wine_type: string;
      region: string | null;
      appellation: string | null;
      country_code: string | null;
      producers: { name: string };
    };
  };
};

const WINE_JOIN =
  "wine_vintages!inner(year, wines!inner(name, wine_type, region, appellation, country_code, producers!inner(name)))";

/** Everything is read, page by page (the data API cuts any one answer at 1000 rows), as the person themselves. */
const BOTTLE_COLUMNS = `status, loc_row, loc_col, format_ml, purchase_price_cents, currency, purchased_at, purchased_from, notes, created_at, opened_at, cellar_locations(label), ${WINE_JOIN}`;

export function createExportRepository(db: Db): ExportRepository {
  return {
    async bottles(householdId, options = {}): Promise<ExportBottleRow[]> {
      // Version 1 reads exactly what it always read. Version 2 also reads the index (migration 0043).
      const columns: string = options.withIndex ? `loc_index, ${BOTTLE_COLUMNS}` : BOTTLE_COLUMNS;
      const { data, error } = await allRows((from, to) =>
        db
          .from("bottles")
          .select(columns)
          .eq("household_id", householdId)
          .order("created_at")
          .order("id")
          .range(from, to),
      );
      if (error) throw options.withIndex ? mapSmartCellarError(error) : mapDbError(error);
      return (data as unknown as BottleRecord[]).map((b) => ({
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
        ...(options.withIndex && typeof b.loc_index === "number" ? { index: b.loc_index } : {}),
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
