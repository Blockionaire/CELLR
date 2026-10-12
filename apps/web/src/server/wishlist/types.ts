import "server-only";
import type { AddWish, UpdateWish, WishlistItem } from "@cellr/domain";

export type WishRow = Omit<WishlistItem, "inCellar">;

export interface WishlistRepository {
  /** Null = the wishlist has not been switched on in the database yet. */
  list(householdId: string): Promise<WishRow[] | null>;
  /** CONFLICT when that wine (and vintage) is already on the list; throws a plain message when not switched on. */
  insert(householdId: string, input: AddWish): Promise<WishRow>;
  update(id: string, patch: UpdateWish): Promise<WishRow | null>;
  remove(id: string): Promise<boolean>;
}
