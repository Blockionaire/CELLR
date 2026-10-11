import "server-only";
import type {
  CreateStorage,
  CreateWine,
  Slot,
  StorageKind,
  WineSummary,
  WineType,
} from "@cellr/domain";

export interface ActiveHousehold {
  id: string;
  currency: string;
}

export interface StorageRow {
  id: string;
  label: string;
  kind: StorageKind;
  rows: number;
  cols: number;
  /** Bottles currently in the cellar that sit in this unit. */
  used: number;
}

/** One physical bottle that is in the cellar, with just enough context to draw a card. */
export interface InventoryRow {
  bottleId: string;
  vintageId: string;
  wineId: string;
  producer: string;
  wineName: string;
  type: WineType;
  year: number | null;
  region: string | null;
  countryCode: string | null;
  locationLabel: string | null;
  addedAt: string;
}

export interface NewBottle {
  vintageId: string;
  formatMl: number;
  locationId: string | null;
  row: number | null;
  col: number | null;
  priceCents: number | null;
  currency: string | null;
  purchasedAt: string | null;
}

/**
 * Data access for the cellar. Every call runs AS the signed-in user, so row-level security is the
 * final authority: another household's rows are simply invisible, and writes into them are refused.
 */
export interface CellarRepository {
  /** The household the caller is working in (their active one, else their first), or null. */
  getActiveHousehold(userId: string): Promise<ActiveHousehold | null>;

  /** Wines the household can pick from: its own plus the shared catalogue. Newest first. */
  listWines(householdId: string): Promise<WineSummary[]>;
  getWine(wineId: string): Promise<WineSummary | null>;
  /** Finds the producer by (accent-insensitive) name or creates a private one. Returns its id. */
  findOrCreateProducer(
    householdId: string,
    name: string,
    countryCode: string | null,
  ): Promise<string>;
  findOrCreateWine(
    householdId: string,
    producerId: string,
    input: CreateWine,
  ): Promise<WineSummary>;
  /** `year` null = non-vintage. Returns the vintage id. */
  findOrCreateVintage(wineId: string, year: number | null): Promise<string>;

  listStorage(householdId: string): Promise<StorageRow[]>;
  getStorage(householdId: string, id: string): Promise<StorageRow | null>;
  occupiedSlots(locationId: string): Promise<Slot[]>;
  createStorage(householdId: string, input: CreateStorage): Promise<StorageRow>;

  insertBottles(householdId: string, rows: NewBottle[]): Promise<string[]>;
  listInventory(householdId: string): Promise<InventoryRow[]>;
}
