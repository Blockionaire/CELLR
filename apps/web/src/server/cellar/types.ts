import "server-only";
import type {
  BottleStatus,
  BottleView,
  CreateStorage,
  CreateWine,
  Descriptor,
  ImageRef,
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
  appellation: string | null;
  countryCode: string | null;
  locationId: string | null;
  locationLabel: string | null;
  row: number | null;
  col: number | null;
  priceCents: number | null;
  currency: string | null;
  addedAt: string;
  /** The label photo of this bottle, if it has one. */
  image: ImageRef | null;
}

/** What a person wrote about a bottle. */
export interface TastingRow {
  id: string;
  vintageId: string;
  bottleId: string | null;
  userId: string;
  userName: string | null;
  score: number | null;
  descriptors: Descriptor[];
  note: string | null;
  tastedAt: string;
}

export interface NewTasting {
  householdId: string;
  vintageId: string;
  bottleId: string;
  score: number | null;
  descriptors: Descriptor[];
  note: string | null;
}

export interface TastingPatch {
  score: number | null;
  descriptors: Descriptor[];
  note: string | null;
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

/** A wine to find or create; an import also knows the appellation. */
export type NewWine = CreateWine & { appellation?: string | null | undefined };

export interface NewBottle {
  vintageId: string;
  formatMl: number;
  locationId: string | null;
  row: number | null;
  col: number | null;
  priceCents: number | null;
  currency: string | null;
  purchasedAt: string | null;
  /** Only an import knows these. */
  purchasedFrom?: string | null | undefined;
  notes?: string | null | undefined;
  /** The label photo the bottle starts with. */
  frontImageId?: string | null | undefined;
}

/** A tasting carried over from an earlier app; the date it happened is kept. */
export interface ImportedTasting {
  householdId: string;
  vintageId: string;
  bottleId: string | null;
  score: number | null;
  note: string | null;
  tastedAt: string;
}

export type BottleRow = BottleView;

/** A vintage with every bottle the household has of it that is in the cellar or already opened. */
export interface VintageRows {
  vintageId: string;
  year: number | null;
  /** The wine itself; whether the viewer has starred it is added by the service. */
  wine: Omit<WineDetail, "favorite">;
  bottles: BottleRow[];
  /** The newest label photo of any of these bottles. */
  image: ImageRef | null;
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
  findOrCreateWine(householdId: string, producerId: string, input: NewWine): Promise<WineSummary>;
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
  /** Which vintage a bottle is of. */
  getBottleVintage(householdId: string, bottleId: string): Promise<string | null>;
  /** Updates one bottle, only if it is currently in one of `fromStatuses`. Null = no such bottle in that state. */
  updateBottle(
    householdId: string,
    bottleId: string,
    patch: BottlePatch,
    fromStatuses: readonly BottleStatus[],
  ): Promise<BottleRow | null>;
  /** A label photo of this household, if it exists (and is theirs to see). */
  getImageRef(householdId: string, imageId: string): Promise<ImageRef | null>;
  /** The newest label photo among the bottles of a vintage, so a new bottle can share it. */
  latestImageId(householdId: string, vintageId: string): Promise<string | null>;
  /** Points every bottle of the vintage (in the cellar or already opened) at the photo. Returns how many. */
  attachImage(householdId: string, vintageId: string, imageId: string | null): Promise<number>;
  /** Removes bottles (undoing a half-finished import). */
  deleteBottles(householdId: string, bottleIds: string[]): Promise<void>;
  /** Marks bottles opened on the given day (an import backdates them). Returns how many changed. */
  markOpened(householdId: string, bottleIds: string[], openedAt: string | null): Promise<number>;
  /** Purchase facts for every bottle of the vintage still in the cellar. Returns how many changed. */
  updatePurchase(householdId: string, vintageId: string, patch: PurchasePatch): Promise<number>;
  /** Null = nothing changed (not yours to edit, e.g. a shared-catalogue wine). */
  updateWine(wineId: string, patch: UpdateWine): Promise<WineSummary | null>;

  /** Everyone's tastings of one vintage in this household, newest first. */
  listTastings(householdId: string, vintageId: string): Promise<TastingRow[]>;
  /** Every rating (not words or notes alone) in this household, to work out averages. */
  listScores(householdId: string): Promise<Array<{ vintageId: string; score: number }>>;
  getMyTasting(userId: string, bottleId: string): Promise<TastingRow | null>;
  /** CONFLICT when this person already has a tasting for the bottle. */
  insertTasting(input: NewTasting): Promise<TastingRow>;
  updateTasting(id: string, patch: TastingPatch): Promise<TastingRow | null>;
  deleteMyTasting(userId: string, bottleId: string): Promise<boolean>;
  /** This person's tastings of the given bottles (score may be null when only words were left). */
  listMyTastingScores(
    userId: string,
    bottleIds: string[],
  ): Promise<Array<{ bottleId: string; score: number | null }>>;

  /** Many tastings at once. Null = ratings are not switched on yet (the database step is still to do). */
  insertTastings(rows: ImportedTasting[]): Promise<number | null>;

  /** The wines this person has starred. Favourites belong to a person, not to the household. */
  listFavoriteWineIds(userId: string): Promise<string[]>;
  /** Stars or un-stars a wine for this person. Doing it twice is harmless. */
  setFavorite(userId: string, wineId: string, favorite: boolean): Promise<void>;
  /** Stars many wines at once. */
  addFavorites(userId: string, wineIds: string[]): Promise<void>;
}
