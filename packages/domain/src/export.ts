import type { BottleStatus, StorageKind, WineType } from "./cellar";

/**
 * YOUR DATA, TAKEN WITH YOU. A readable copy of everything the household keeps: written in words (wine and
 * producer names, places by name, prices as ordinary numbers, ratings in stars), not in ids, so it makes sense
 * in a text editor or a spreadsheet and does not depend on this app to be understood.
 */
export const EXPORT_VERSION = 1;

export interface CellrExport {
  app: "cellr";
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  household: { name: string; currency: string };
  places: Array<{ name: string; kind: StorageKind; shelves: number; positionsPerShelf: number }>;
  /** Every bottle the household has ever had: in the cellar, opened, gifted or removed. */
  bottles: Array<{
    producer: string;
    wine: string;
    vintage: number | null;
    type: WineType;
    country: string | null;
    region: string | null;
    appellation: string | null;
    status: BottleStatus;
    place: string | null;
    shelf: number | null;
    position: number | null;
    sizeMl: number;
    price: number | null;
    currency: string | null;
    purchasedOn: string | null;
    purchasedFrom: string | null;
    notes: string | null;
    addedAt: string;
    openedAt: string | null;
  }>;
  tastings: Array<{
    producer: string;
    wine: string;
    vintage: number | null;
    /** In stars, in half steps (0.5 to 5). */
    stars: number | null;
    words: string[];
    note: string | null;
    tastedAt: string;
    by: string | null;
  }>;
  /** The wines you (the person exporting) have starred. */
  favorites: Array<{ producer: string; wine: string }>;
  wishlist: Array<{
    producer: string;
    wine: string;
    vintage: number | null;
    note: string | null;
    maxPrice: number | null;
    addedAt: string;
  }>;
}

/** A name for the downloaded file: `cellr-2026-10-12.json`. */
export const exportFileName = (at: Date) => `cellr-${at.toISOString().slice(0, 10)}.json`;
