import "server-only";
import type {
  BottleStatus,
  BottleView,
  CreateStorage,
  CreateWine,
  Slot,
  StorageKind,
  UpdateStorage,
  UpdateWine,
  WineDetail,
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
  locationId: string | null;
  locationLabel: string | null;
  row: number | null;
  col: number | null;
  priceCents: number | null;
  currency: string | null;
  addedAt: string;
}

/** One opened bottle, with what it was. */
export interface OpenedRow {
  bottleId: string;
  vintageId: string;
  producer: string;
  wineName: string;
  type: WineType;
  year: number | null;
  openedAt: string;
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

export type BottleRow = BottleView;

/** A vintage with every bottle the household has of it that is in the cellar or already opened. */
export interface VintageRows {
  vintageId: string;
  year: number | null;
  /** The wine itself; whether the viewer has starred it is added by the service. */
  wine: Omit<WineDetail, "favorite">;
  bottles: BottleRow[];
}

export interface BottlePatch {
  status?: BottleStatus;
  locationId?: string | null;
  row?: number | null;
  col?: number | null;
  /** Set to null when a bottle comes back into the cellar. */
  openedAt?: null;
}

export interface PurchasePatch {
  priceCents?: number | null;
  currency?: string | null;
  purchasedAt?: string | null;
  purchasedFrom?: string | null;
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
  /** Null = no such place in this household. */
  updateStorage(householdId: string, id: string, patch: UpdateStorage): Promise<StorageRow | null>;
  /** False = nothing was deleted (not the owner, or already gone). */
  deleteStorage(householdId: string, id: string): Promise<boolean>;

  insertBottles(householdId: string, rows: NewBottle[]): Promise<string[]>;
  listInventory(householdId: string): Promise<InventoryRow[]>;
  /** The most recently opened bottles, newest first. */
  listRecentlyOpened(householdId: string, limit: number): Promise<OpenedRow[]>;

  getVintage(householdId: string, vintageId: string): Promise<VintageRows | null>;
  getBottle(householdId: string, bottleId: string): Promise<BottleRow | null>;
  /** Updates one bottle, only if it is currently in one of `fromStatuses`. Null = no such bottle in that state. */
  updateBottle(
    householdId: string,
    bottleId: string,
    patch: BottlePatch,
    fromStatuses: readonly BottleStatus[],
  ): Promise<BottleRow | null>;
  /** Purchase facts for every bottle of the vintage still in the cellar. Returns how many changed. */
  updatePurchase(householdId: string, vintageId: string, patch: PurchasePatch): Promise<number>;
  /** Null = nothing changed (not yours to edit, e.g. a shared-catalogue wine). */
  updateWine(wineId: string, patch: UpdateWine): Promise<WineSummary | null>;

  /** The wines this person has starred. Favourites belong to a person, not to the household. */
  listFavoriteWineIds(userId: string): Promise<string[]>;
  /** Stars or un-stars a wine for this person. Doing it twice is harmless. */
  setFavorite(userId: string, wineId: string, favorite: boolean): Promise<void>;
}
