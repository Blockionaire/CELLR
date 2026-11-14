import { STORAGE_KINDS, type StorageKind } from "./cellar";
import type { GridSize, Slot } from "./placement";
import {
  StorageZoneSchema,
  checkZones,
  readAppearance,
  type StorageAppearance,
  type StorageStructure,
  type StorageZone,
} from "./storage-config";
import {
  uniformLayout,
  type LogicalLayout,
  type SlotAddress,
  type SlotLike,
} from "./storage-layout";
import {
  DEFAULT_TEMPLATE_FOR_KIND,
  STORAGE_LIMITS,
  STORAGE_TEMPLATES,
  getStorageTemplate,
  type SlotSemantics,
  type StorageTemplate,
} from "./storage-templates";

/**
 * OLD AND NEW SIDE BY SIDE (Smart Cellar 3D, sprint 1A). Every place that exists today is a kind and a grid, and
 * every bottle in one is at (row, col). This is the one place that says what those are in the new terms, so the
 * existing screens, services and 3D view keep working on what they already have while new code reads the same
 * places through the layout engine.
 *
 * The rules of reading (they differ from writing, which is strict: see storage-config):
 * 1. What decides which spots exist is what the database enforces: the size of the grid and, once it is stored,
 *    how many bottles a cell holds. Those are never narrowed to a template's limits, so no bottle's spot is ever
 *    read away.
 * 2. Everything else is a hint. A template this app does not know, zones that do not add up, a look from another
 *    version: each falls back to something safe and is reported in `fallbacks`, never thrown.
 */

// ---- Spots ----------------------------------------------------------------------------------------------------------

/** A spot as it was always stored: (row, col). It is index 1 of that cell. */
export const fromLegacySlot = (slot: Slot): SlotAddress => ({
  row: slot.row,
  col: slot.col,
  index: 1,
});

/**
 * The two-coordinate form of a spot, for code and clients that know no index: only index 1 has one. A bottle
 * behind another (index 2 and up) has no legacy form, and must not be passed off as the front one: null.
 */
export const toLegacySlot = (slot: SlotLike): Slot | null =>
  (slot.index ?? 1) === 1 ? { row: slot.row, col: slot.col } : null;

/** The layout of a grid as the app has always known it: `rows` x `cols` cells of one bottle. */
export const legacyGridLayout = (grid: GridSize): LogicalLayout =>
  uniformLayout({
    family: "grid",
    semantics: "depth",
    rows: grid.rows,
    cols: grid.cols,
    cellCapacity: 1,
  });

// ---- Places ---------------------------------------------------------------------------------------------------------

/**
 * A place as it is stored. The first three fields are today's (cellar_locations.kind / grid_rows / grid_cols);
 * the rest do not exist in the database yet and are simply absent for every place there is.
 */
export interface StoredStorage {
  kind: StorageKind;
  rows: number;
  cols: number;
  /** The template's id. Absent or null: a place from before templates. */
  template?: string | null | undefined;
  /** Bottles per cell. Absent or null: 1. */
  cellCapacity?: number | null | undefined;
  zones?: unknown;
  appearance?: unknown;
}

/** What was not usable as stored, and so was replaced by something safe. */
export type StorageFallback =
  "unknown_kind" | "unknown_template" | "size" | "cell_capacity" | "zones" | "appearance";

export interface ResolvedStorage {
  template: StorageTemplate;
  structure: StorageStructure;
  appearance: StorageAppearance;
  layout: LogicalLayout;
  /**
   * A place from before templates (no template stored). It is exactly what it was: a `rows` x `cols` grid of
   * single spots, and the renderer keeps drawing it the way it always has.
   */
  legacy: boolean;
  /** Empty when everything stored was used as it is. */
  fallbacks: StorageFallback[];
}

const clampCount = (value: unknown, max: number): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(1, Math.trunc(value)))
    : null;

function readZones(
  template: StorageTemplate,
  rows: number,
  stored: unknown,
): { zones: StorageZone[]; ok: boolean } {
  if (stored === undefined || stored === null) return { zones: [], ok: true };
  const parsed = StorageZoneSchema.array().max(STORAGE_LIMITS.zones).safeParse(stored);
  if (!parsed.success || checkZones(template, rows, parsed.data) !== null)
    return { zones: [], ok: false };
  return { zones: parsed.data, ok: true };
}

/**
 * Reads a stored place into the new terms. Never throws; see the rules at the top of this file.
 * For a place from before templates the result is its kind's default template over its own grid, one bottle per
 * cell, no zones, the default look, and `legacy: true`.
 */
export function resolveStorage(stored: StoredStorage): ResolvedStorage {
  const fallbacks: StorageFallback[] = [];

  const knownKind = (STORAGE_KINDS as readonly string[]).includes(stored.kind);
  if (!knownKind) fallbacks.push("unknown_kind");
  const kind: StorageKind = knownKind ? stored.kind : "other";

  const legacy = stored.template === undefined || stored.template === null;
  let template = legacy ? null : getStorageTemplate(stored.template);
  if (!legacy && !template) fallbacks.push("unknown_template");
  template ??= STORAGE_TEMPLATES[DEFAULT_TEMPLATE_FOR_KIND[kind]];

  const rows = clampCount(stored.rows, STORAGE_LIMITS.rows);
  const cols = clampCount(stored.cols, STORAGE_LIMITS.cols);
  if (rows !== stored.rows || cols !== stored.cols) fallbacks.push("size");

  const wantedCapacity = stored.cellCapacity ?? 1;
  const cellCapacity = clampCount(wantedCapacity, STORAGE_LIMITS.cellCapacity);
  if (cellCapacity !== wantedCapacity) fallbacks.push("cell_capacity");

  const structure: StorageStructure = {
    template: template.id,
    rows: rows ?? 1,
    cols: cols ?? 1,
    cellCapacity: cellCapacity ?? 1,
    zones: [],
  };

  // A template of one spot per cell that is stored with more: the spots exist (rule 1), but nothing is claimed
  // about where in the cell they are.
  const semantics: SlotSemantics =
    template.semantics === "single" && structure.cellCapacity > 1 ? "ordinal" : template.semantics;
  const layout = uniformLayout({
    family: template.family,
    semantics,
    rows: structure.rows,
    cols: structure.cols,
    cellCapacity: structure.cellCapacity,
  });

  const zones = readZones(template, structure.rows, stored.zones);
  if (!zones.ok) fallbacks.push("zones");
  structure.zones = zones.zones;

  const look = readAppearance(template.id, stored.appearance);
  // No look stored at all is the normal case (every place today), not something that went wrong.
  if (look.source !== "stored" && stored.appearance !== undefined && stored.appearance !== null)
    fallbacks.push("appearance");

  return { template, structure, appearance: look.appearance, layout, legacy, fallbacks };
}
