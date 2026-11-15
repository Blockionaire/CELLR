import "server-only";
import {
  DomainError,
  type OccupiedSpot,
  type SmartPlacementView,
  type StorageKind,
  type WineType,
} from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { isMissingTable, mapDbError, missingColumn } from "@/server/db/errors";
import { allRows } from "@/server/db/paging";
import type {
  LayoutWrite,
  SaveLayoutOutcome,
  SmartCellarRepository,
  StoredPlaceRow,
} from "./types";

const PLACE_COLUMNS =
  "id, label, kind, grid_rows, grid_cols, template, cell_capacity, slot_semantics, appearance";
const ZONE_COLUMNS = "location_id, zone_index, from_row, to_row, purpose, target_temp_c";
const PLACEMENT_COLUMNS =
  "id, location_id, loc_row, loc_col, loc_index, vintage_id, wine_vintages!inner(year, wine_id, wines!inner(name, wine_type, producers!inner(name)))";

/**
 * A database without the Smart Cellar step (migrations 0043-0045): the columns, the zones table or the function are
 * not there. ONLY these codes mean that. A permission error, a timeout or any other failure is not evidence that the
 * schema is missing, and is passed on as what it is.
 * PGRST202: PostgREST cannot find the function.
 */
export const isSchemaMissing = (error: { code?: string | undefined }): boolean =>
  missingColumn(error) || isMissingTable(error) || error.code === "PGRST202";

export const NOT_SET_UP = "The Smart Cellar isn't set up on this server yet.";

/** Errors of the Smart Cellar API's own calls. */
export function mapSmartCellarError(error: {
  code?: string | undefined;
  message?: string | undefined;
}): DomainError {
  if (isSchemaMissing(error)) return new DomainError("NOT_FOUND", NOT_SET_UP, { cause: error });
  // Two writers that ran into each other (a deadlock, a lock that was not free, a serialisation failure): nothing
  // was changed, and trying again is the remedy. (zone_place_busy, 55P03, is one of these: migration 0044.)
  if (error.code === "40P01" || error.code === "40001" || error.code === "55P03")
    return new DomainError("CONFLICT", "Someone else was changing this place. Try again.", {
      cause: error,
      retryable: true,
    });
  return mapDbError(error);
}

type PlaceRecord = {
  id: string;
  label: string;
  kind: string;
  grid_rows: number;
  grid_cols: number;
  template: string | null;
  cell_capacity: number;
  slot_semantics: string | null;
  appearance: unknown;
};
type ZoneRecord = {
  location_id: string;
  zone_index: number;
  from_row: number;
  to_row: number;
  purpose: string;
  target_temp_c: number | string | null;
};

/** A temperature as PostgREST sends a numeric: a number, or (for some settings) a string. */
const temperature = (value: number | string | null): number | null => {
  if (value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Pure: a row of cellar_locations, its zone rows and its count of bottles, in the domain's words. Unit-tested. */
export function toStoredPlace(
  r: PlaceRecord,
  zones: readonly ZoneRecord[],
  occupied: number,
): StoredPlaceRow {
  return {
    id: r.id,
    label: r.label,
    kind: r.kind as StorageKind,
    rows: r.grid_rows,
    cols: r.grid_cols,
    template: r.template,
    cellCapacity: r.cell_capacity,
    semantics: r.slot_semantics,
    appearance: r.appearance,
    zones: [...zones]
      .sort((a, b) => a.zone_index - b.zone_index)
      .map((z) => ({
        fromRow: z.from_row,
        toRow: z.to_row,
        purpose: z.purpose as StoredPlaceRow["zones"][number]["purpose"],
        targetTempC: temperature(z.target_temp_c),
      })),
    occupied,
  };
}

type PlacementRecord = {
  id: string;
  location_id: string | null;
  loc_row: number | null;
  loc_col: number | null;
  loc_index: number;
  vintage_id: string;
  wine_vintages: {
    year: number | null;
    wine_id: string;
    wines: { name: string; wine_type: string; producers: { name: string } };
  };
};

/**
 * Pure: a bottle row in the domain's words, its spot WHOLE. The index is the database's (never null there: every
 * bottle from before depth is at its default, 1) and is never reduced. A row without a full spot is not a placement.
 */
export function toPlacement(r: PlacementRecord): SmartPlacementView | null {
  if (r.location_id === null || r.loc_row === null || r.loc_col === null) return null;
  return {
    bottleId: r.id,
    locationId: r.location_id,
    row: r.loc_row,
    col: r.loc_col,
    index: r.loc_index,
    vintageId: r.vintage_id,
    wineId: r.wine_vintages.wine_id,
    producer: r.wine_vintages.wines.producers.name,
    wineName: r.wine_vintages.wines.name,
    year: r.wine_vintages.year,
    type: r.wine_vintages.wines.wine_type as WineType,
  };
}

const OUTCOMES: readonly SaveLayoutOutcome[] = [
  "saved",
  "not_found",
  "in_use",
  "semantics_change",
  "invalid_zones",
  "depth_not_enabled",
];

/** The zones as save_storage_layout reads them: snake_case keys, top zone first. */
export const zonesForRpc = (zones: LayoutWrite["zones"]) =>
  zones.map((z) => ({
    from_row: z.fromRow,
    to_row: z.toRow,
    purpose: z.purpose,
    target_temp_c: z.targetTempC,
  }));

export function createSmartCellarRepository(db: Db): SmartCellarRepository {
  /** Bottles in the cellar per place of the household (every place at once, page by page). */
  async function occupancy(householdId: string): Promise<Map<string, number>> {
    const { data, error } = await allRows((from, to) =>
      db
        .from("bottles")
        .select("location_id")
        .eq("household_id", householdId)
        .eq("status", "in_cellar")
        .not("location_id", "is", null)
        .order("id")
        .range(from, to),
    );
    if (error) throw mapSmartCellarError(error);
    const used = new Map<string, number>();
    for (const row of data)
      if (row.location_id) used.set(row.location_id, (used.get(row.location_id) ?? 0) + 1);
    return used;
  }

  async function zonesOf(householdId: string, locationId?: string): Promise<ZoneRecord[]> {
    let query = db
      .from("cellar_location_zones")
      .select(ZONE_COLUMNS)
      .eq("household_id", householdId);
    if (locationId) query = query.eq("location_id", locationId);
    const { data, error } = await query.order("location_id").order("zone_index");
    if (error) throw mapSmartCellarError(error);
    return data ?? [];
  }

  return {
    async schemaReady() {
      const probes = await Promise.all([
        db
          .from("cellar_locations")
          .select("template, cell_capacity, slot_semantics, appearance")
          .limit(0),
        db.from("bottles").select("loc_index").limit(0),
        db.from("cellar_location_zones").select("id").limit(0),
      ]);
      for (const { error } of probes) {
        if (!error) continue;
        if (isSchemaMissing(error)) return false;
        throw mapDbError(error);
      }
      return true;
    },

    async listPlaces(householdId) {
      const [places, zones, used] = await Promise.all([
        db
          .from("cellar_locations")
          .select(PLACE_COLUMNS)
          .eq("household_id", householdId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
          .order("id"),
        zonesOf(householdId),
        occupancy(householdId),
      ]);
      if (places.error) throw mapSmartCellarError(places.error);
      const byPlace = new Map<string, ZoneRecord[]>();
      for (const z of zones) byPlace.set(z.location_id, [...(byPlace.get(z.location_id) ?? []), z]);
      return (places.data ?? []).map((r) =>
        toStoredPlace(r, byPlace.get(r.id) ?? [], used.get(r.id) ?? 0),
      );
    },

    async getPlace(householdId, id) {
      const { data, error } = await db
        .from("cellar_locations")
        .select(PLACE_COLUMNS)
        .eq("household_id", householdId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw mapSmartCellarError(error);
      if (!data) return null;
      const [zones, count] = await Promise.all([
        zonesOf(householdId, id),
        db
          .from("bottles")
          .select("id", { count: "exact", head: true })
          .eq("household_id", householdId)
          .eq("location_id", id)
          .eq("status", "in_cellar"),
      ]);
      if (count.error) throw mapSmartCellarError(count.error);
      return toStoredPlace(data, zones, count.count ?? 0);
    },

    async placements(householdId, locationId) {
      // at most 1200 per place (the database's limit), so at most two pages
      const { data, error } = await allRows((from, to) =>
        db
          .from("bottles")
          .select(PLACEMENT_COLUMNS)
          .eq("household_id", householdId)
          .eq("location_id", locationId)
          .eq("status", "in_cellar")
          .order("loc_row")
          .order("loc_col")
          .order("loc_index")
          .order("id")
          .range(from, to),
      );
      if (error) throw mapSmartCellarError(error);
      return data.flatMap((r) => {
        const placement = toPlacement(r);
        return placement ? [placement] : [];
      });
    },

    async occupiedSpots(householdId, locationId) {
      const { data, error } = await allRows((from, to) =>
        db
          .from("bottles")
          .select("loc_row, loc_col, loc_index")
          .eq("household_id", householdId)
          .eq("location_id", locationId)
          .eq("status", "in_cellar")
          .order("id")
          .range(from, to),
      );
      if (error) throw mapSmartCellarError(error);
      return data.flatMap((r): OccupiedSpot[] =>
        r.loc_row !== null && r.loc_col !== null
          ? [{ row: r.loc_row, col: r.loc_col, index: r.loc_index }]
          : [],
      );
    },

    async saveLayout(householdId, id, layout) {
      const { data, error } = await db.rpc("save_storage_layout", {
        p_household: householdId,
        p_location: id,
        p_kind: layout.kind,
        p_template: layout.template,
        p_slot_semantics: layout.semantics,
        p_rows: layout.rows,
        p_cols: layout.cols,
        p_cell_capacity: layout.cellCapacity,
        p_appearance: layout.appearance,
        p_zones: zonesForRpc(layout.zones),
      });
      // No fallback of any kind: a layout is written by this one function, in one transaction, or not at all.
      if (error) throw mapSmartCellarError(error);
      if (!OUTCOMES.includes(data as SaveLayoutOutcome))
        throw new DomainError("INTERNAL", undefined, { cause: { answer: data }, retryable: false });
      return data as SaveLayoutOutcome;
    },
  };
}
