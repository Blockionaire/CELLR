import type { StorageKind, WineType } from "./cellar";
import type { ImageRef } from "./image";
import type { StorageFallback, ResolvedStorage } from "./storage-compat";
import type { StorageAppearance, StorageConfig, StorageZone } from "./storage-config";
import {
  STORAGE_TEMPLATES,
  getStorageTemplate,
  type LayoutFamily,
  type SlotSemantics,
  type StorageTemplateId,
} from "./storage-templates";

/**
 * THE SMART CELLAR API (Smart Cellar 3D, sprint 1C): what the server says about a place and the bottles in it, in
 * the new terms, next to the two-coordinate API that every client of today uses and that stays exactly as it is.
 *
 * Everything here is read through `resolveStorage` (storage-compat), so the rules of reading live in one place:
 * nothing stored is narrowed, nothing unknown is guessed, and whatever was not usable is reported, not hidden.
 * This file adds only what an API needs on top: how to SAY what an index means without claiming more than is known,
 * which changes of a layout would take a bottle's spot away, and which edits through the old API would make a
 * place disagree with its template.
 */

/** The version of the Smart Cellar representation. A client that does not know a newer one must not guess it. */
export const SMART_CELLAR_API_VERSION = 1;

/**
 * Whether bottles may lie more than one per cell. OFF, here and in the database (private.cellar_settings), and
 * nothing in the app can switch it on: that takes a decision of the owner and a migration. Every write path checks
 * this first and refuses, so a request never even reaches the database's own refusal.
 */
export const DEPTH_PLACEMENT_ENABLED = false;

// ---- What an index means, said truthfully ------------------------------------------------------------------------------

/**
 * What the index of a spot means in a place, as a reader may rely on it:
 * - `single`: one position per cell. The index is always 1 and means nothing more.
 * - `depth`: a physical position, 1 at the front. Only ever said when the app KNOWS how the place is arranged.
 * - `ordinal`: a counter within a cell (a bin), or an index in a place whose arrangement is not known. It is never
 *   a position anyone can point at.
 */
export type IndexMeaning = SlotSemantics;

/**
 * The truthful meaning of an index for a resolved place. Differs from `resolved.layout.semantics` in one way: a place
 * whose arrangement is not known is never said to have depth, whatever template stands in for it.
 */
export function indexMeaningOf(resolved: ResolvedStorage): IndexMeaning {
  if (resolved.structure.cellCapacity <= 1) return "single";
  if (!resolved.arrangementKnown) return "ordinal";
  return resolved.layout.semantics;
}

// ---- Read models ----------------------------------------------------------------------------------------------------------

/** One temperature zone. `targetTempC` is what the owner SET (or null): never a reading. */
export type SmartZoneView = StorageZone;

/** A place, in the new terms. */
export interface SmartStorageUnitView {
  id: string;
  label: string;
  kind: StorageKind;
  /**
   * The template as stored: null for a place from before templates. An id this server does not know (written by a
   * newer app) is returned as it is, and `arrangementKnown` is then false.
   */
  templateId: string | null;
  /**
   * The template the place is drawn and limited with: the stored one when it is known and consistent, otherwise the
   * kind's default, standing in. Never read this as "what the furniture is" unless `arrangementKnown`.
   */
  layoutTemplateId: StorageTemplateId;
  family: LayoutFamily;
  /** Exactly as stored: never narrowed to a template's limits (a bottle's spot is never read away). */
  rows: number;
  cols: number;
  cellCapacity: number;
  /**
   * cellar_locations.slot_semantics exactly as stored (null without a template), so that a client reading the place
   * with `resolveStorage` reaches the same result as the server. What a reader may rely on is `indexMeaning`.
   */
  slotSemantics: string | null;
  /** What an index means here, truthfully (see indexMeaningOf). */
  indexMeaning: IndexMeaning;
  /** Versioned (`v`). A stored look this server cannot read is replaced by the template's default (see fallbacks). */
  appearance: StorageAppearance;
  /** Top zone first. Empty: none, or the stored ones did not split the shelves (see fallbacks). */
  zones: SmartZoneView[];
  /** rows × cols × cellCapacity. */
  capacity: number;
  /** Bottles in the cellar that are in this place. */
  occupied: number;
  free: number;
  /** A place from before templates, one bottle per cell: drawn exactly as it always was. */
  legacy: boolean;
  arrangementKnown: boolean;
  /** What was not usable as stored. Empty when everything was. */
  fallbacks: StorageFallback[];
  /**
   * Which version of the place this is (opaque; changes whenever the place does: its layout, look, zones or name).
   * A layout save may send it back (If-Match) to be refused when someone changed the place in the meantime.
   */
  revision: string;
}

/**
 * One bottle on its spot. The spot is the WHOLE logical slot (locationId, row, col, index): a bottle from before
 * depth is at index 1, and an index above 1 is never reported as 1.
 */
export interface SmartPlacementView {
  bottleId: string;
  locationId: string;
  row: number;
  col: number;
  index: number;
  vintageId: string;
  wineId: string;
  producer: string;
  wineName: string;
  year: number | null;
  type: WineType;
  /** Where the wine is from, as the wine's own record says (null: not said). */
  region: string | null;
  countryCode: string | null;
  /**
   * The bottle's own label photo, when the household took one (served by /api/v1/images/:id to members only).
   * Null: no photo; the label is then drawn from the names above, never invented.
   */
  image: ImageRef | null;
}

/** A place and every bottle on a spot in it. */
export interface SmartStoragePlacementsView {
  unit: SmartStorageUnitView;
  placements: SmartPlacementView[];
}

/** What this server offers of the Smart Cellar API. */
export interface SmartCellarCapabilities {
  version: typeof SMART_CELLAR_API_VERSION;
  /** Reading places in the new terms. */
  reads: boolean;
  /** Saving a layout. Off unless switched on for a non-production deployment. */
  writes: boolean;
  /**
   * More than one bottle per cell may be offered and written here. Decided on the server (sprint 9, ADR-011 §5):
   * false unless the depth gate is open AND the database says depth is on and the old index is gone. Always false
   * where the gate is closed (production, and everywhere by default).
   */
  depthPlacement: boolean;
  /**
   * Only where the server's depth gate is open (never on production): what decided `depthPlacement`. Absent
   * everywhere else, so a server with the gate closed answers exactly what it answered before sprint 9.
   */
  depth?: SmartDepthCapability;
  /**
   * What the database has, for reading and for writing apart:
   * - `reads`: the Smart Cellar columns and the zones table (migrations 0043, 0044), checked with zero-row reads.
   * - `writes`: save_storage_layout with its parameters (0045). "ready" only where PostgREST describes it to this
   *   caller; "missing" where it describes itself without it; "unverified" where it does not describe itself to this
   *   caller (hosted Supabase, 2026). It is never found out by calling it: that function writes. A save on a database
   *   without it is refused before anything runs, and nothing changes.
   */
  schema: { reads: "ready" | "missing"; writes: "ready" | "missing" | "unverified" };
  catalogVersion: number;
  appearanceVersion: number;
  exportVersions: readonly number[];
}

// ---- Depth as a capability (sprint 9) ---------------------------------------------------------------------------------------

/** What the database says about depth (public.smart_cellar_depth_status(), migration 0054), in the domain's words. */
export interface DepthDatabaseStatus {
  /** private.cellar_settings.depth_placement: the database's own switch. */
  depthPlacement: boolean;
  /** bottles_slot_unique (0004) still exists: then a cell holds one bottle whatever the switch says. */
  legacyCellIndex: boolean;
  /** bottles_slot_index_unique (0043) is in force. */
  indexUnique: boolean;
  /** move_bottle_v2 (0054) exists. */
  moveV2: boolean;
}

export type DepthBlock =
  /** The database cannot say (no migration 0054, or the answer could not be read): never taken as "on". */
  | "database_unknown"
  /** The database's switch is off. */
  | "database_switch_off"
  /** The old one-bottle-per-cell index is still in force. */
  | "legacy_index"
  /** The index-aware unique index is missing. */
  | "index_missing"
  /** move_bottle_v2 is missing. */
  | "move_missing";

export interface SmartDepthCapability {
  /** The server's depth gate is open here (it is, or this would not be said). */
  gate: true;
  /** What the database said, or null when it could not say. */
  database: DepthDatabaseStatus | null;
  /** Depth may be offered and written. */
  open: boolean;
  /** Why not, when not. */
  blockedBy: DepthBlock | null;
}

/**
 * Whether depth is on as far as the database is concerned: ALL of its switch on, the old index gone, the new one in
 * force and move_bottle_v2 there. Anything unknown is "off". Pure; the server adds its own gate (ADR-011 §5).
 */
export function depthBlockOf(status: DepthDatabaseStatus | null): DepthBlock | null {
  if (!status) return "database_unknown";
  if (!status.depthPlacement) return "database_switch_off";
  if (status.legacyCellIndex) return "legacy_index";
  if (!status.indexUnique) return "index_missing";
  if (!status.moveV2) return "move_missing";
  return null;
}

/** The database's answer (jsonb) read strictly: anything that is not exactly the four booleans is "cannot say". */
export function readDepthStatus(value: unknown): DepthDatabaseStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const keys = ["depth_placement", "legacy_cell_index", "index_unique", "move_v2"] as const;
  if (!keys.every((k) => typeof v[k] === "boolean")) return null;
  return {
    depthPlacement: v.depth_placement as boolean,
    legacyCellIndex: v.legacy_cell_index as boolean,
    indexUnique: v.index_unique as boolean,
    moveV2: v.move_v2 as boolean,
  };
}

// ---- Saving a layout ------------------------------------------------------------------------------------------------------

/** A place as it is now, for deciding whether a change of its layout is safe. */
export interface CurrentLayout {
  rows: number;
  cols: number;
  cellCapacity: number;
  /** As stored; null for a place from before templates. */
  semantics: string | null;
}

/** A bottle's spot within the place being changed. */
export interface OccupiedSpot {
  row: number;
  col: number;
  index: number;
}

export type LayoutChangeProblem =
  /** More than one bottle per cell, while that is switched off. */
  | "depth_not_enabled"
  /** A bottle would lose its spot: fewer shelves, cells or positions per cell than it needs. */
  | "in_use"
  /** What an index means would change under bottles whose index means something (more than one per cell). */
  | "semantics_change";

/**
 * Whether a layout may replace the current one. The same three rules the database enforces (private.check_location_
 * cells, check_location_resize and save_storage_layout), checked first so that a person is told plainly. The database
 * stays the final authority: a bottle placed between this check and the save is still caught there.
 */
export function layoutChangeProblem(
  current: CurrentLayout,
  next: StorageConfig["structure"],
  occupied: readonly OccupiedSpot[],
  options: { depthEnabled?: boolean | undefined } = {},
): LayoutChangeProblem | null {
  const depthEnabled = options.depthEnabled ?? DEPTH_PLACEMENT_ENABLED;
  if (next.cellCapacity > 1 && !depthEnabled) return "depth_not_enabled";
  if (occupied.some((s) => s.row > next.rows || s.col > next.cols || s.index > next.cellCapacity))
    return "in_use";
  const nextSemantics = STORAGE_TEMPLATES[next.template].semantics;
  // A place one deep holds every bottle at index 1, which means the same under every meaning: nothing to protect.
  if (current.semantics !== nextSemantics && current.cellCapacity > 1 && occupied.length > 0)
    return "semantics_change";
  return null;
}

// ---- What can be saved today ------------------------------------------------------------------------------------------

/**
 * Whether a configuration with this many bottles per cell can be SAVED in this version: one per cell, unless depth
 * placement is switched on. Anything more can be designed and looked at (a preview), never stored.
 */
export const cellCapacitySavable = (cellCapacity: number): boolean =>
  cellCapacitySavableWith(cellCapacity, DEPTH_PLACEMENT_ENABLED);

/**
 * The same, where the SERVER has decided whether depth is open here (sprint 9: the capability `depthPlacement`). A
 * function of its own, not an optional argument: the one-argument versions are passed to `filter` and `map`, which
 * would hand them an index.
 */
export const cellCapacitySavableWith = (cellCapacity: number, depthEnabled: boolean): boolean =>
  cellCapacity <= 1 || depthEnabled === true;

/**
 * Whether a template can be saved at all in this version: it must come in a size of one bottle per cell. A template
 * that starts at two (a double-depth rack, bins) is preview only: it is never quietly saved as something it is not.
 */
export const templateSavable = (id: StorageTemplateId): boolean =>
  templateSavableWith(id, DEPTH_PLACEMENT_ENABLED);

/** templateSavable where the server has decided whether depth is open here (see cellCapacitySavableWith). */
export const templateSavableWith = (id: StorageTemplateId, depthEnabled: boolean): boolean =>
  cellCapacitySavableWith(STORAGE_TEMPLATES[id].cellCapacity.min, depthEnabled);

/** What the Smart Cellar API answers on a database without its step (migrations 0043-0045). */
export const SMART_CELLAR_NOT_SET_UP = "The Smart Cellar isn't set up on this server yet.";

/** What a conditional edit of a place (If-Match) answers when it asks for more than a new name. */
export const CONDITIONAL_RENAME_ONLY = "Only a new name can be saved against a version of a place.";

/** What a layout save answers when the place changed since the person opened it (If-Match did not match). */
export const STALE_LAYOUT_MESSAGE =
  "This place was changed since you opened it. Reload it to see the latest version.";

// ---- Edits through the old API -----------------------------------------------------------------------------------------

/** A place with a template, as the old API's edit sees it. */
export interface TemplatedPlace {
  template: string;
  kind: StorageKind;
  rows: number;
  cols: number;
  cellCapacity: number;
}

export type LegacyEditProblem =
  /** The template is one this server does not know: its limits cannot be checked, so its shape is not changed. */
  | "unknown_template"
  /** The kind of a place follows from its template; a different kind would make the two disagree. */
  | "kind_mismatch"
  /** The size is outside what the template allows. */
  | "size_outside_template";

/**
 * Whether an edit through the old two-coordinate API (PATCH /api/v1/storage/:id: label, kind, rows, cols) may be
 * applied to a place that has a template. A place without a template is not asked: it is edited as it always was.
 * A rename is always fine. Zones are the database's to check (a change of shelves that leaves the zones without a
 * split is refused at commit).
 */
export function legacyEditProblem(
  place: TemplatedPlace,
  patch: { kind?: StorageKind | undefined; rows?: number | undefined; cols?: number | undefined },
): LegacyEditProblem | null {
  const shaping = patch.kind !== undefined || patch.rows !== undefined || patch.cols !== undefined;
  if (!shaping) return null;
  const template = getStorageTemplate(place.template);
  if (!template) return "unknown_template";
  if (patch.kind !== undefined && patch.kind !== template.kind) return "kind_mismatch";
  const rows = patch.rows ?? place.rows;
  const cols = patch.cols ?? place.cols;
  const inside = (value: number, limit: { min: number; max: number }) =>
    value >= limit.min && value <= limit.max;
  if (
    !inside(rows, template.rows) ||
    !inside(cols, template.cols) ||
    rows * cols * place.cellCapacity > template.maxCapacity
  )
    return "size_outside_template";
  return null;
}
