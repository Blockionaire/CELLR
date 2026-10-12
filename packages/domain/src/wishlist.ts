import { z } from "zod";
import { MAX_PRICE_CENTS, VintageYearSchema, type WineType } from "./cellar";

/**
 * THE WISHLIST: wines the household would like to buy, shared like the cellar. A wish is a wine (found or made
 * exactly as when adding a bottle), optionally one vintage of it, a note, and a price it should stay under.
 */

const NoteSchema = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : v))
  .nullable();

export const AddWishSchema = z.object({
  wineId: z.uuid(),
  /** null = any vintage. */
  year: VintageYearSchema.default(null),
  note: NoteSchema.default(null),
  /** The most it should cost, per bottle, in the household's currency. */
  maxPriceCents: z.number().int().min(0).max(MAX_PRICE_CENTS).nullable().default(null),
});
export type AddWish = z.infer<typeof AddWishSchema>;

export const UpdateWishSchema = z
  .object({
    year: VintageYearSchema,
    note: NoteSchema,
    maxPriceCents: z.number().int().min(0).max(MAX_PRICE_CENTS).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");
export type UpdateWish = z.infer<typeof UpdateWishSchema>;

export interface WishlistItem {
  id: string;
  wineId: string;
  producer: string;
  wineName: string;
  type: WineType;
  region: string | null;
  countryCode: string | null;
  year: number | null;
  note: string | null;
  maxPriceCents: number | null;
  /** Bottles of this wine (any vintage) already in the cellar: a reminder before buying a fourth. */
  inCellar: number;
  addedAt: string;
}

export interface WishlistView {
  items: WishlistItem[];
  currency: string;
  /** False until the database step that creates the list has been run; the screen then says so kindly. */
  ready: boolean;
}
