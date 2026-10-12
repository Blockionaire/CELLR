import "server-only";
import {
  DomainError,
  type AddWish,
  type UpdateWish,
  type WishlistItem,
  type WishlistView,
} from "@cellr/domain";
import type { ActiveHousehold } from "@/server/cellar/types";
import type { WishlistRepository, WishRow } from "./types";

export interface WishlistDeps {
  repo: WishlistRepository;
  household: () => Promise<ActiveHousehold>;
  /** Whether a wine can be seen by this household (its own, or the shared catalogue). */
  wineExists: (wineId: string) => Promise<boolean>;
  /** How many bottles of each wine are in the cellar now. */
  bottlesByWine: (householdId: string) => Promise<ReadonlyMap<string, number>>;
}

export function createWishlistService({
  repo,
  household,
  wineExists,
  bottlesByWine,
}: WishlistDeps) {
  const withCounts = (rows: WishRow[], counts: ReadonlyMap<string, number>): WishlistItem[] =>
    rows.map((r) => ({ ...r, inCellar: counts.get(r.wineId) ?? 0 }));

  return {
    async list(): Promise<WishlistView> {
      const { id, currency } = await household();
      const rows = await repo.list(id);
      if (rows === null) return { items: [], currency, ready: false };
      return { items: withCounts(rows, await bottlesByWine(id)), currency, ready: true };
    },

    async add(input: AddWish): Promise<WishlistItem> {
      const { id } = await household();
      if (!(await wineExists(input.wineId)))
        throw new DomainError("NOT_FOUND", "We couldn't find that wine.");
      const row = await repo.insert(id, input);
      return { ...row, inCellar: (await bottlesByWine(id)).get(row.wineId) ?? 0 };
    },

    async update(wishId: string, patch: UpdateWish): Promise<WishlistItem> {
      const { id } = await household();
      const row = await repo.update(wishId, patch);
      if (!row) throw new DomainError("NOT_FOUND");
      return { ...row, inCellar: (await bottlesByWine(id)).get(row.wineId) ?? 0 };
    },

    async remove(wishId: string): Promise<void> {
      await household();
      if (!(await repo.remove(wishId))) throw new DomainError("NOT_FOUND");
    },
  };
}

export type WishlistService = ReturnType<typeof createWishlistService>;
