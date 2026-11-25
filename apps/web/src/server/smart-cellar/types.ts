import "server-only";
import type {
  AdviceOccupant,
  SmartSpot,
  WineType,
  OccupiedSpot,
  SmartCellarCapabilities,
  SmartPlacementView,
  StorageAppearance,
  StorageKind,
  StorageZone,
} from "@cellr/domain";

/**
 * A place exactly as the database holds it (cellar_locations and its rows of cellar_location_zones), read as the
 * signed-in person: nothing is interpreted here. `resolveStorage` (packages/domain) does all the interpreting.
 */
export interface StoredPlaceRow {
  id: string;
  label: string;
  kind: StorageKind;
  rows: number;
  cols: number;
  template: string | null;
  cellCapacity: number;
  /** cellar_locations.slot_semantics, as stored. */
  semantics: string | null;
  /** The stored look, unread: it may be of another version, or not a look at all. */
  appearance: unknown;
  /** The zone rows, top first, in the domain's field names. Not checked here: they may not split the shelves. */
  zones: Array<Pick<StorageZone, "fromRow" | "toRow" | "purpose" | "targetTempC">>;
  /** Bottles in the cellar in this place. */
  occupied: number;
  /** cellar_locations.updated_at, as text: changes whenever the row does (a trigger sets it). */
  revision: string;
}

export type SchemaStatus = SmartCellarCapabilities["schema"];

/**
 * What save_storage_layout (migration 0045) answers, and save_storage_layout_v2 (0055): the same, plus 'stale' (the
 * place is no longer at the revision the caller named; nothing changed). Anything else either does is an error.
 */
export type SaveLayoutOutcome =
  | "saved"
  | "not_found"
  | "in_use"
  | "semantics_change"
  | "invalid_zones"
  | "depth_not_enabled"
  | "stale";

/** A bottle in a place, with its whole spot (for checking a placement before the database is asked). */
export interface OccupantRow {
  bottleId: string;
  row: number;
  col: number;
  index: number;
}

/** What one conditional move answers. */
export type MoveOutcome =
  | { kind: "moved"; to: SmartSpot | null }
  /** The bottle already stands on the target and no longer on the source: a repeat of a move that happened. */
  | { kind: "already_there" }
  /** The bottle is not where the caller saw it. Nothing changed. */
  | { kind: "stale"; now: SmartSpot | null }
  /** Another bottle holds the target (the unique index). Nothing changed. */
  | { kind: "taken" }
  /** Not a spot of that place (the database's bounds check). Nothing changed. */
  | { kind: "out_of_bounds" }
  /** A bottle behind another one would be carried to another cell with its index: refused (0043). */
  | { kind: "ambiguous" }
  /** No longer in the cellar. */
  | { kind: "gone" }
  | { kind: "not_found" };

/** What swap_bottles_v2 (migration 0045) answers. */
export type SwapOutcome = "swapped" | "stale" | "gone" | "invalid" | "not_found";

/** The whole layout save_storage_layout replaces, in one transaction. */
export interface LayoutWrite {
  kind: StorageKind;
  template: string;
  semantics: string;
  rows: number;
  cols: number;
  cellCapacity: number;
  appearance: StorageAppearance;
  /** Top zone first; [] removes them. */
  zones: StorageZone[];
}

/**
 * Data access for the Smart Cellar API. Every call runs AS the signed-in user (row-level security and column grants
 * apply, the functions are SECURITY INVOKER): another household's places are invisible, and writes to them refused.
 * A database without migrations 0043-0045 is answered with a "not set up here" error, never by guessing.
 */
export interface SmartCellarRepository {
  /**
   * Whether the database has what the API reads with (0043, 0044) and what it writes with (0045), each on its own.
   * Never by calling a function that writes. Any failure that is not "this is not there" is thrown, not taken as "no".
   */
  schemaStatus(): Promise<SchemaStatus>;
  listPlaces(householdId: string): Promise<StoredPlaceRow[]>;
  getPlace(householdId: string, id: string): Promise<StoredPlaceRow | null>;
  /** The bottles in the cellar on a spot of this place, with their whole spot. */
  placements(householdId: string, locationId: string): Promise<SmartPlacementView[]>;
  /** Just the spots that are taken in this place (for checking a change of layout). */
  occupiedSpots(householdId: string, locationId: string): Promise<OccupiedSpot[]>;
  /**
   * One save of a layout: all of it or none of it. With `expectedRevision` (the place's updated_at as the caller read
   * it, unchanged), save_storage_layout_v2 (0055) compares it under the place's row lock and answers 'stale' when the
   * place has moved on. Without one, or on a database without 0055 (PostgREST: no such function, nothing ran),
   * save_storage_layout (0045) exactly as before.
   */
  saveLayout(
    householdId: string,
    id: string,
    layout: LayoutWrite,
    expectedRevision?: string | null,
  ): Promise<SaveLayoutOutcome>;
  /** The bottles in the cellar in this place, each with its whole spot and its id. */
  occupants(householdId: string, locationId: string): Promise<OccupantRow[]>;
  /**
   * Moves ONE bottle from the spot the caller saw it on to `to`, in ONE conditional UPDATE: it applies only while the
   * bottle is in the cellar on exactly `from` (null: without a place). Atomic by itself; the unique indexes decide a
   * taken target and the 0043 trigger the bounds.
   */
  moveBottle(
    householdId: string,
    bottleId: string,
    from: SmartSpot | null,
    to: SmartSpot | null,
  ): Promise<MoveOutcome>;
  /**
   * The facts advice uses about one bottle of this household (sprint 5): its spot and the stable ids of its vintage,
   * wine and producer, its type and year. As the person (RLS); null when this household has no such bottle.
   */
  adviceBottle(householdId: string, bottleId: string): Promise<AdviceBottleRow | null>;
  /**
   * Every bottle of the household on a spot, with the ids grouping compares: ONE paged read for the whole cellar
   * (never one per place or per spot).
   */
  adviceOccupants(householdId: string): Promise<AdviceOccupant[]>;
  /**
   * Where one bottle of this household is now (as the person: another household's bottle is not found, null).
   * `spot` is null for a bottle without a place, and for one no longer in the cellar.
   */
  bottleSpot(
    householdId: string,
    bottleId: string,
  ): Promise<{ inCellar: boolean; spot: SmartSpot | null } | null>;
  /** One call of swap_bottles_v2 (0045): both bottles on the spots the caller saw, both moved at once, or nothing. */
  swapBottles(
    householdId: string,
    a: { bottleId: string; spot: SmartSpot },
    b: { bottleId: string; spot: SmartSpot },
  ): Promise<SwapOutcome>;
}

/** One bottle as advice reads it (repository → service). */
export interface AdviceBottleRow {
  bottleId: string;
  inCellar: boolean;
  spot: SmartSpot | null;
  vintageId: string;
  /** Null when this person can't read the catalogue row (RLS): then never "related" to other bottles. */
  wineId: string | null;
  producerId: string | null;
  type: WineType | null;
  year: number | null;
}
