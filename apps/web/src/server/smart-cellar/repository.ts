import "server-only";
import {
  sameSpot,
  type SmartSpot,
  SMART_CELLAR_NOT_SET_UP,
  DomainError,
  type ImageRef,
  type OccupiedSpot,
  type SmartPlacementView,
  type StorageKind,
  type WineType,
} from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { isMissingTable, mapDbError, missingColumn } from "@/server/db/errors";
import { allRows } from "@/server/db/paging";
import { IMAGE_REF_COLUMNS, toImageRef } from "@/server/cellar/repository";
import type {
  LayoutWrite,
  SaveLayoutOutcome,
  SchemaStatus,
  SmartCellarRepository,
  StoredPlaceRow,
} from "./types";

const PLACE_COLUMNS =
  "id, label, kind, grid_rows, grid_cols, template, cell_capacity, slot_semantics, appearance, updated_at";
const ZONE_COLUMNS = "location_id, zone_index, from_row, to_row, purpose, target_temp_c";
const PLACEMENT_COLUMNS =
  "id, location_id, loc_row, loc_col, loc_index, vintage_id, front_image_id, wine_vintages!inner(year, wine_id, wines!inner(name, wine_type, region, country_code, producers!inner(name)))";
/** Label photos are asked for by id, this many at a time (an address has a limit to its length). */
const IMAGE_CHUNK = 150;

/**
 * A database without the Smart Cellar step (migrations 0043-0045): the columns, the zones table or the function are
 * not there. ONLY these codes mean that. A permission error, a timeout or any other failure is not evidence that the
 * schema is missing, and is passed on as what it is.
 * PGRST202: PostgREST cannot find the function.
 */
export const isSchemaMissing = (error: { code?: string | undefined }): boolean =>
  missingColumn(error) || isMissingTable(error) || error.code === "PGRST202";

export const NOT_SET_UP = SMART_CELLAR_NOT_SET_UP;

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
  updated_at: string;
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
    revision: r.updated_at,
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
  front_image_id?: string | null;
  wine_vintages: {
    year: number | null;
    wine_id: string;
    wines: {
      name: string;
      wine_type: string;
      region?: string | null;
      country_code?: string | null;
      producers: { name: string };
    };
  };
};

/**
 * Pure: a bottle row in the domain's words, its spot WHOLE. The index is the database's (never null there: every
 * bottle from before depth is at its default, 1) and is never reduced. A row without a full spot is not a placement.
 */
export function toPlacement(
  r: PlacementRecord,
  images: ReadonlyMap<string, ImageRef> = new Map(),
): SmartPlacementView | null {
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
    region: r.wine_vintages.wines.region ?? null,
    countryCode: r.wine_vintages.wines.country_code ?? null,
    // a photo that is named but cannot be read (deleted, or not this household's) is no photo: never a broken one
    image: r.front_image_id ? (images.get(r.front_image_id) ?? null) : null,
  };
}

/** The parameters of save_storage_layout as migration 0045 created it: what the API calls it with. */
export const LAYOUT_FUNCTION_PARAMS = [
  "p_household",
  "p_location",
  "p_kind",
  "p_template",
  "p_slot_semantics",
  "p_rows",
  "p_cols",
  "p_cell_capacity",
  "p_appearance",
  "p_zones",
] as const;

type Described = { status: number; body: unknown };

/**
 * Pure: what PostgREST's description of itself (its OpenAPI document) says about the one function a layout is
 * saved with. PostgREST describes what the CALLER may execute ("follow-privileges", its default), so:
 *   true    save_storage_layout is there, with every parameter of 0045, for this caller;
 *   false   it is not (no such function, another signature, or not executable by this caller): a call would fail;
 *   null    this is not a description at all (nothing can be concluded).
 * Unit-tested with the document the local stack's PostgREST serves.
 */
export function layoutFunctionDescribed(doc: unknown): boolean | null {
  if (!doc || typeof doc !== "object") return null;
  const paths = (doc as { paths?: unknown }).paths;
  if (!paths || typeof paths !== "object") return null;
  const path = (paths as Record<string, unknown>)["/rpc/save_storage_layout"] as
    | {
        get?: { parameters?: Array<{ name?: unknown }> };
        post?: { parameters?: Array<{ schema?: { properties?: Record<string, unknown> } }> };
      }
    | undefined;
  if (!path || typeof path !== "object") return false;
  const names = new Set<string>();
  for (const p of path.get?.parameters ?? []) if (typeof p?.name === "string") names.add(p.name);
  for (const p of path.post?.parameters ?? [])
    for (const name of Object.keys(p?.schema?.properties ?? {})) names.add(name);
  return LAYOUT_FUNCTION_PARAMS.every((name) => names.has(name));
}

/**
 * Pure: whether a layout can be saved, from PostgREST's answer to "describe yourself" (never from calling the
 * function: save_storage_layout writes, and a call made to find out whether it exists would be a write).
 *   - a description that lists it with 0045's parameters: "ready"; one that does not: "missing";
 *   - no description for this caller (refused: 401, 403; switched off: 404, PGRST126; not a description): "unverified".
 *     Hosted Supabase no longer describes itself to requests made with the publishable key (2026): there the answer
 *     is "unverified", never "ready" without evidence. The write path stays safe either way: a call of a function
 *     PostgREST does not have is refused by PostgREST before anything runs (PGRST202), and is answered "isn't set up".
 *   - anything else (a server error): not evidence of anything, so an error.
 */
export function writeReadiness(described: Described): SchemaStatus["writes"] {
  const code = (described.body as { code?: unknown } | null)?.code;
  if ([401, 403, 404].includes(described.status) || code === "PGRST126") return "unverified";
  if (described.status < 200 || described.status >= 300)
    throw new DomainError("INTERNAL", undefined, {
      cause: { describe: described.status },
      retryable: true,
    });
  const listed = layoutFunctionDescribed(described.body);
  return listed === null ? "unverified" : listed ? "ready" : "missing";
}

/**
 * PostgREST's description of itself, asked AS the caller: the same address, key, session and fetch every query of
 * this client uses (a query builder's public `url`, `headers` and `fetch`), at the root of the data API.
 */
async function describeDataApi(db: Db): Promise<Described> {
  const table = db.from("cellar_locations");
  const headers = new Headers(table.headers);
  headers.set("Accept", "application/openapi+json");
  const response = await (table.fetch ?? fetch)(new URL("./", table.url).href, {
    method: "GET",
    headers,
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
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

  /**
   * Every zone row of the household (or of one place), page by page: the data API cuts any one answer at 1000 rows
   * without saying so. (location_id, zone_index) is unique, so the order is stable from page to page.
   */
  async function zonesOf(householdId: string, locationId?: string): Promise<ZoneRecord[]> {
    const { data, error } = await allRows((from, to) => {
      let query = db
        .from("cellar_location_zones")
        .select(ZONE_COLUMNS)
        .eq("household_id", householdId);
      if (locationId) query = query.eq("location_id", locationId);
      return query.order("location_id").order("zone_index").range(from, to);
    });
    if (error) throw mapSmartCellarError(error);
    return data;
  }

  return {
    async schemaStatus() {
      // Reading (0043, 0044): the columns and the zones table, asked for with zero rows.
      const probes = await Promise.all([
        db
          .from("cellar_locations")
          .select("template, cell_capacity, slot_semantics, appearance")
          .limit(0),
        db.from("bottles").select("loc_index").limit(0),
        db.from("cellar_location_zones").select("id").limit(0),
      ]);
      let reads: SchemaStatus["reads"] = "ready";
      for (const { error } of probes) {
        if (!error) continue;
        if (!isSchemaMissing(error)) throw mapDbError(error);
        reads = "missing";
      }
      // Writing (0045) comes after both: without them it cannot be there.
      if (reads === "missing") return { reads, writes: "missing" };
      return { reads, writes: writeReadiness(await describeDataApi(db)) };
    },

    async listPlaces(householdId) {
      // Every place, page by page (the data API cuts an answer at 1000 rows without saying so), in the order the
      // app has always listed them; the id last, so the order is the same on every page.
      const [places, zones, used] = await Promise.all([
        allRows((from, to) =>
          db
            .from("cellar_locations")
            .select(PLACE_COLUMNS)
            .eq("household_id", householdId)
            .order("sort_order", { ascending: true })
            .order("created_at", { ascending: true })
            .order("id")
            .range(from, to),
        ),
        zonesOf(householdId),
        occupancy(householdId),
      ]);
      if (places.error) throw mapSmartCellarError(places.error);
      const byPlace = new Map<string, ZoneRecord[]>();
      for (const z of zones) {
        const list = byPlace.get(z.location_id);
        if (list) list.push(z);
        else byPlace.set(z.location_id, [z]);
      }
      return places.data.map((r) => toStoredPlace(r, byPlace.get(r.id) ?? [], used.get(r.id) ?? 0));
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
      // The label photos of exactly these bottles (ids only, of this household), a chunk at a time.
      const wanted = [
        ...new Set(data.flatMap((r) => (r.front_image_id ? [r.front_image_id] : []))),
      ];
      const images = new Map<string, ImageRef>();
      for (let at = 0; at < wanted.length; at += IMAGE_CHUNK) {
        const found = await db
          .from("bottle_images")
          .select(IMAGE_REF_COLUMNS)
          .eq("household_id", householdId)
          .in("id", wanted.slice(at, at + IMAGE_CHUNK));
        if (found.error) throw mapSmartCellarError(found.error);
        for (const image of found.data ?? []) images.set(image.id, toImageRef(image));
      }
      return data.flatMap((r) => {
        const placement = toPlacement(r, images);
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

    async occupants(householdId, locationId) {
      const { data, error } = await allRows((from, to) =>
        db
          .from("bottles")
          .select("id, loc_row, loc_col, loc_index")
          .eq("household_id", householdId)
          .eq("location_id", locationId)
          .eq("status", "in_cellar")
          .order("id")
          .range(from, to),
      );
      if (error) throw mapSmartCellarError(error);
      return data.flatMap((r) =>
        r.loc_row !== null && r.loc_col !== null
          ? [{ bottleId: r.id, row: r.loc_row, col: r.loc_col, index: r.loc_index }]
          : [],
      );
    },

    async moveBottle(householdId, bottleId, from, to) {
      let write = db
        .from("bottles")
        .update({
          location_id: to?.locationId ?? null,
          loc_row: to?.row ?? null,
          loc_col: to?.col ?? null,
          loc_index: to?.index ?? 1,
        })
        .eq("id", bottleId)
        .eq("household_id", householdId)
        .eq("status", "in_cellar");
      // the whole spot the caller saw, every field: the update applies only while the bottle is still there
      write = from
        ? write
            .eq("location_id", from.locationId)
            .eq("loc_row", from.row)
            .eq("loc_col", from.col)
            .eq("loc_index", from.index)
        : write.is("location_id", null);
      const { data, error } = await write.select("id").maybeSingle();
      if (error) {
        if (error.code === "23505") return { kind: "taken" };
        if (error.message === "slot_out_of_bounds") return { kind: "out_of_bounds" };
        if (error.message === "slot_index_ambiguous") return { kind: "ambiguous" };
        throw mapSmartCellarError(error);
      }
      // a "move" onto the spot it was seen on (and still is): applied as a no-op, answered as such
      if (data) return sameSpot(from, to) ? { kind: "already_there" } : { kind: "moved", to };
      // Nothing matched. Read where the bottle is now (as the person: another household's bottle is not found).
      const now = await db
        .from("bottles")
        .select("status, location_id, loc_row, loc_col, loc_index")
        .eq("id", bottleId)
        .eq("household_id", householdId)
        .maybeSingle();
      if (now.error) throw mapSmartCellarError(now.error);
      if (!now.data) return { kind: "not_found" };
      if (now.data.status !== "in_cellar") return { kind: "gone" };
      const spot: SmartSpot | null =
        now.data.location_id !== null && now.data.loc_row !== null && now.data.loc_col !== null
          ? {
              locationId: now.data.location_id,
              row: now.data.loc_row,
              col: now.data.loc_col,
              index: now.data.loc_index,
            }
          : null;
      if (sameSpot(spot, to)) return { kind: "already_there" };
      return { kind: "stale", now: spot };
    },

    async swapBottles(householdId, a, b) {
      const { data, error } = await db.rpc("swap_bottles_v2", {
        p_household: householdId,
        p_a: a.bottleId,
        p_a_location: a.spot.locationId,
        p_a_row: a.spot.row,
        p_a_col: a.spot.col,
        p_a_index: a.spot.index,
        p_b: b.bottleId,
        p_b_location: b.spot.locationId,
        p_b_row: b.spot.row,
        p_b_col: b.spot.col,
        p_b_index: b.spot.index,
      });
      if (error) {
        if (error.code === "23505") return "stale";
        throw mapSmartCellarError(error);
      }
      return data === "swapped" || data === "stale" || data === "gone" || data === "invalid"
        ? data
        : "not_found";
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
