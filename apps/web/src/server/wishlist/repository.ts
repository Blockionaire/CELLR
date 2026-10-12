import "server-only";
import { DomainError, type WineType } from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import type { Database } from "@/server/db/database.types";
import { isMissingTable, mapDbError } from "@/server/db/errors";
import type { WishlistRepository, WishRow } from "./types";

const COLUMNS =
  "id, wine_id, year, note, max_price_cents, created_at, wines!inner(name, wine_type, region, country_code, producers!inner(name))";

const notReady = () =>
  new DomainError(
    "INTERNAL",
    "The wishlist needs one more database step before it works. Everything else is fine. See docs/SETUP.md, “Updating the database”.",
  );

export const toWish = (r: {
  id: string;
  wine_id: string;
  year: number | null;
  note: string | null;
  max_price_cents: number | null;
  created_at: string;
  wines: {
    name: string;
    wine_type: string;
    region: string | null;
    country_code: string | null;
    producers: { name: string };
  };
}): WishRow => ({
  id: r.id,
  wineId: r.wine_id,
  producer: r.wines.producers.name,
  wineName: r.wines.name,
  type: r.wines.wine_type as WineType,
  region: r.wines.region,
  countryCode: r.wines.country_code,
  year: r.year,
  note: r.note,
  maxPriceCents: r.max_price_cents,
  addedAt: r.created_at,
});

export function createWishlistRepository(db: Db): WishlistRepository {
  return {
    async list(householdId) {
      const { data, error } = await db
        .from("wishlist_items")
        .select(COLUMNS)
        .eq("household_id", householdId)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error && isMissingTable(error)) return null;
      if (error) throw mapDbError(error);
      return (data ?? []).map(toWish);
    },

    async insert(householdId, input) {
      const { data, error } = await db
        .from("wishlist_items")
        .insert({
          household_id: householdId,
          wine_id: input.wineId,
          year: input.year,
          note: input.note,
          max_price_cents: input.maxPriceCents,
        })
        .select(COLUMNS)
        .single();
      if (error) {
        if (isMissingTable(error)) throw notReady();
        if (error.code === "23505")
          throw new DomainError("CONFLICT", "That wine is already on your wishlist.");
        throw mapDbError(error);
      }
      return toWish(data);
    },

    async update(id, patch) {
      const update: Database["public"]["Tables"]["wishlist_items"]["Update"] = {};
      if (patch.year !== undefined) update.year = patch.year;
      if (patch.note !== undefined) update.note = patch.note;
      if (patch.maxPriceCents !== undefined) update.max_price_cents = patch.maxPriceCents;
      const { data, error } = await db
        .from("wishlist_items")
        .update(update)
        .eq("id", id)
        .select(COLUMNS)
        .maybeSingle();
      if (error) {
        if (isMissingTable(error)) throw notReady();
        if (error.code === "23505")
          throw new DomainError("CONFLICT", "That wine is already on your wishlist.");
        throw mapDbError(error);
      }
      return data ? toWish(data) : null;
    },

    async remove(id) {
      const { data, error } = await db.from("wishlist_items").delete().eq("id", id).select("id");
      if (error) {
        if (isMissingTable(error)) throw notReady();
        throw mapDbError(error);
      }
      return (data?.length ?? 0) > 0;
    },
  };
}
