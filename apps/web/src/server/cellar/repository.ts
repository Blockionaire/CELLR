import "server-only";
import {
  DomainError,
  normalizeText,
  type CreateStorage,
  type CreateWine,
  type Slot,
  type StorageKind,
  type WineSummary,
  type WineType,
} from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import type { Database } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type {
  ActiveHousehold,
  CellarRepository,
  InventoryRow,
  NewBottle,
  StorageRow,
} from "./types";

type Tables = Database["public"]["Tables"];

const WINE_COLUMNS = "id, name, wine_type, country_code, region, producers!inner(name)";
const STORAGE_COLUMNS = "id, label, kind, grid_rows, grid_cols";
/** A household sees its own private rows plus the shared catalogue (owner = null). */
const visibleTo = (householdId: string) =>
  `owner_household_id.eq.${householdId},owner_household_id.is.null`;

// ---- Pure row mappers (unit-tested) ---------------------------------------------------------------
export const toWine = (r: {
  id: string;
  name: string;
  wine_type: string;
  country_code: string | null;
  region: string | null;
  producers: { name: string };
}): WineSummary => ({
  id: r.id,
  producer: r.producers.name,
  name: r.name,
  type: r.wine_type as WineType,
  countryCode: r.country_code,
  region: r.region,
});

export const toStorage = (
  r: {
    id: string;
    label: string;
    kind: string;
    grid_rows: number;
    grid_cols: number;
  },
  used: number,
): StorageRow => ({
  id: r.id,
  label: r.label,
  kind: r.kind as StorageKind,
  rows: r.grid_rows,
  cols: r.grid_cols,
  used,
});

// `normalized_name` is filled by a database trigger (and is not a grantable column), but the generated
// Insert types still list it as required, hence the two `as …["Insert"]` casts below.
const isUniqueViolation = (error: { code?: string }) => error.code === "23505";

export function createCellarRepository(db: Db): CellarRepository {
  async function usedByLocation(householdId: string): Promise<Map<string, number>> {
    const { data, error } = await db
      .from("bottles")
      .select("location_id")
      .eq("household_id", householdId)
      .eq("status", "in_cellar")
      .not("location_id", "is", null);
    if (error) throw mapDbError(error);
    const used = new Map<string, number>();
    for (const row of data ?? []) {
      if (row.location_id) used.set(row.location_id, (used.get(row.location_id) ?? 0) + 1);
    }
    return used;
  }

  /** Every household has one cellar; people only ever see its storage units. */
  async function ensureCellar(householdId: string): Promise<string> {
    const { data, error } = await db
      .from("cellars")
      .select("id")
      .eq("household_id", householdId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw mapDbError(error);
    if (data) return data.id;
    const created = await db
      .from("cellars")
      .insert({ household_id: householdId, name: "Cellar" })
      .select("id")
      .single();
    if (created.error) throw mapDbError(created.error);
    return created.data.id;
  }

  return {
    async getActiveHousehold(userId): Promise<ActiveHousehold | null> {
      const profile = await db
        .from("profiles")
        .select("active_household_id")
        .eq("id", userId)
        .maybeSingle();
      if (profile.error) throw mapDbError(profile.error);
      // RLS only shows households the caller belongs to, so a stale profile pointer finds nothing.
      const wanted = profile.data?.active_household_id ?? null;
      if (wanted) {
        const h = await db.from("households").select("id, currency").eq("id", wanted).maybeSingle();
        if (h.error) throw mapDbError(h.error);
        if (h.data) return h.data;
      }
      const first = await db
        .from("households")
        .select("id, currency")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (first.error) throw mapDbError(first.error);
      return first.data;
    },

    async listWines(householdId) {
      const { data, error } = await db
        .from("wines")
        .select(WINE_COLUMNS)
        .or(visibleTo(householdId))
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw mapDbError(error);
      return (data ?? []).map(toWine);
    },

    async getWine(wineId) {
      const { data, error } = await db
        .from("wines")
        .select(WINE_COLUMNS)
        .eq("id", wineId)
        .maybeSingle();
      if (error) throw mapDbError(error);
      return data ? toWine(data) : null;
    },

    async findOrCreateProducer(householdId, name, countryCode) {
      const normalized = normalizeText(name);
      const find = async (): Promise<string | null> => {
        const { data, error } = await db
          .from("producers")
          .select("id, country_code")
          .eq("normalized_name", normalized)
          .or(visibleTo(householdId))
          .limit(5);
        if (error) throw mapDbError(error);
        const rows = data ?? [];
        const sameCountry = countryCode ? rows.find((r) => r.country_code === countryCode) : null;
        return (sameCountry ?? rows[0])?.id ?? null;
      };
      const existing = await find();
      if (existing) return existing;
      const { data, error } = await db
        .from("producers")
        .insert({
          name,
          country_code: countryCode,
          status: "provisional",
          owner_household_id: householdId,
          origin: "user_entered",
        } as Tables["producers"]["Insert"])
        .select("id")
        .single();
      if (error) {
        if (isUniqueViolation(error)) {
          const raced = await find();
          if (raced) return raced;
        }
        throw mapDbError(error);
      }
      return data.id;
    },

    async findOrCreateWine(householdId, producerId, input: CreateWine) {
      const find = async (): Promise<WineSummary | null> => {
        const { data, error } = await db
          .from("wines")
          .select(WINE_COLUMNS)
          .eq("producer_id", producerId)
          .eq("normalized_name", normalizeText(input.name))
          .eq("wine_type", input.type)
          .or(visibleTo(householdId))
          .limit(1)
          .maybeSingle();
        if (error) throw mapDbError(error);
        return data ? toWine(data) : null;
      };
      const existing = await find();
      if (existing) return existing;
      const { data, error } = await db
        .from("wines")
        .insert({
          producer_id: producerId,
          name: input.name,
          wine_type: input.type,
          country_code: input.countryCode ?? null,
          region: input.region ?? null,
          status: "provisional",
          owner_household_id: householdId,
          origin: "user_entered",
        } as Tables["wines"]["Insert"])
        .select(WINE_COLUMNS)
        .single();
      if (error) {
        if (isUniqueViolation(error)) {
          const raced = await find();
          if (raced) return raced;
        }
        throw mapDbError(error);
      }
      return toWine(data);
    },

    async findOrCreateVintage(wineId, year) {
      const find = async (): Promise<string | null> => {
        const base = db.from("wine_vintages").select("id").eq("wine_id", wineId);
        const { data, error } = await (
          year === null ? base.is("year", null) : base.eq("year", year)
        )
          .limit(1)
          .maybeSingle();
        if (error) throw mapDbError(error);
        return data?.id ?? null;
      };
      const existing = await find();
      if (existing) return existing;
      const { data, error } = await db
        .from("wine_vintages")
        .insert({ wine_id: wineId, year })
        .select("id")
        .single();
      if (error) {
        if (isUniqueViolation(error)) {
          const raced = await find();
          if (raced) return raced;
        }
        throw mapDbError(error);
      }
      return data.id;
    },

    async listStorage(householdId) {
      const [locations, used] = await Promise.all([
        db
          .from("cellar_locations")
          .select(STORAGE_COLUMNS)
          .eq("household_id", householdId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
        usedByLocation(householdId),
      ]);
      if (locations.error) throw mapDbError(locations.error);
      return (locations.data ?? []).map((r) => toStorage(r, used.get(r.id) ?? 0));
    },

    async getStorage(householdId, id) {
      const { data, error } = await db
        .from("cellar_locations")
        .select(STORAGE_COLUMNS)
        .eq("household_id", householdId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw mapDbError(error);
      if (!data) return null;
      const count = await db
        .from("bottles")
        .select("id", { count: "exact", head: true })
        .eq("location_id", id)
        .eq("status", "in_cellar");
      if (count.error) throw mapDbError(count.error);
      return toStorage(data, count.count ?? 0);
    },

    async occupiedSlots(locationId): Promise<Slot[]> {
      const { data, error } = await db
        .from("bottles")
        .select("loc_row, loc_col")
        .eq("location_id", locationId)
        .eq("status", "in_cellar");
      if (error) throw mapDbError(error);
      return (data ?? []).flatMap((r) =>
        r.loc_row !== null && r.loc_col !== null ? [{ row: r.loc_row, col: r.loc_col }] : [],
      );
    },

    async createStorage(householdId, input: CreateStorage) {
      const cellarId = await ensureCellar(householdId);
      const { data, error } = await db
        .from("cellar_locations")
        .insert({
          cellar_id: cellarId,
          household_id: householdId,
          label: input.label,
          kind: input.kind,
          grid_rows: input.rows,
          grid_cols: input.cols,
        })
        .select(STORAGE_COLUMNS)
        .single();
      if (error) {
        if (isUniqueViolation(error))
          throw new DomainError("CONFLICT", "You already have a place with that name.");
        throw mapDbError(error);
      }
      return toStorage(data, 0);
    },

    async insertBottles(householdId, rows: NewBottle[]) {
      const inserts: Tables["bottles"]["Insert"][] = rows.map((r) => ({
        household_id: householdId,
        vintage_id: r.vintageId,
        format_ml: r.formatMl,
        status: "in_cellar",
        location_id: r.locationId,
        loc_row: r.row,
        loc_col: r.col,
        purchase_price_cents: r.priceCents,
        currency: r.currency,
        purchased_at: r.purchasedAt,
      }));
      const { data, error } = await db.from("bottles").insert(inserts).select("id");
      if (error) throw mapDbError(error);
      return (data ?? []).map((r) => r.id);
    },

    async listInventory(householdId): Promise<InventoryRow[]> {
      const { data, error } = await db
        .from("bottles")
        .select(
          "id, created_at, wine_vintages!inner(id, year, wines!inner(id, name, wine_type, region, country_code, producers!inner(name))), cellar_locations(label)",
        )
        .eq("household_id", householdId)
        .eq("status", "in_cellar")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw mapDbError(error);
      return (data ?? []).map((b) => ({
        bottleId: b.id,
        vintageId: b.wine_vintages.id,
        wineId: b.wine_vintages.wines.id,
        producer: b.wine_vintages.wines.producers.name,
        wineName: b.wine_vintages.wines.name,
        type: b.wine_vintages.wines.wine_type as WineType,
        year: b.wine_vintages.year,
        region: b.wine_vintages.wines.region,
        countryCode: b.wine_vintages.wines.country_code,
        locationLabel: b.cellar_locations?.label ?? null,
        addedAt: b.created_at,
      }));
    },
  };
}
