import "server-only";
import type {
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
}

export type SchemaStatus = SmartCellarCapabilities["schema"];

/** What save_storage_layout (migration 0045) answers. Anything else it does is an error. */
export type SaveLayoutOutcome =
  "saved" | "not_found" | "in_use" | "semantics_change" | "invalid_zones" | "depth_not_enabled";

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
  /** One call of save_storage_layout: all of it or none of it. */
  saveLayout(householdId: string, id: string, layout: LayoutWrite): Promise<SaveLayoutOutcome>;
}
