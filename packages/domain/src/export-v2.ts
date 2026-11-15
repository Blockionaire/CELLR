import type { StorageKind } from "./cellar";
import type { CellrExport } from "./export";
import type { IndexMeaning } from "./smart-cellar";
import type { StorageFallback } from "./storage-compat";
import type { StorageAppearance } from "./storage-config";
import type { ZonePurpose } from "./storage-templates";

/**
 * YOUR DATA, TAKEN WITH YOU, VERSION 2 (Smart Cellar 3D, sprint 1C). Everything version 1 has, exactly as version 1
 * writes it, and on top what a place is since templates: which piece of furniture, how many bottles a position
 * holds, its look, its temperature zones, and for every bottle its index within its position.
 *
 * Version 1 (export.ts) is unchanged and stays the default; version 2 is only written when asked for by number.
 *
 * Read `index` with its place's `indexMeaning`: an index is a physical depth only where that says "depth". In a bin
 * ("ordinal") it is a counter that shifts when a bottle is taken out, and in a place whose arrangement is not known
 * it is never a position: the file says so, so that nothing reading it later can take it for one.
 */
export const EXPORT_V2_VERSION = 2;

/** The export versions this app can write. */
export const EXPORT_VERSIONS = [1, EXPORT_V2_VERSION] as const;
export type ExportVersion = (typeof EXPORT_VERSIONS)[number];

export interface ExportV2Zone {
  /** Shelves, both ends included, top to bottom. */
  fromShelf: number;
  toShelf: number;
  purpose: ZonePurpose;
  /** The temperature the owner SET this zone to (°C), or null. A setting someone typed in, never a measurement. */
  setToC: number | null;
}

export interface ExportV2Place {
  name: string;
  kind: StorageKind;
  /** The template's id as stored. Null: a place from before templates. */
  template: string | null;
  /**
   * `legacy`: a place from before templates, one bottle per position, as it always was.
   * `known`: the template says how the place is built.
   * `unknown`: the app could not tell (a template it does not know, or one that does not fit what is stored);
   * positions and their capacity are exact, but nothing is claimed about where in a position a bottle lies.
   */
  arrangement: "legacy" | "known" | "unknown";
  shelves: number;
  positionsPerShelf: number;
  bottlesPerPosition: number;
  /** shelves × positionsPerShelf × bottlesPerPosition. */
  capacity: number;
  /** What a bottle's `index` means here: "single" (always 1), "depth" (1 is the front), or "ordinal" (a counter). */
  indexMeaning: IndexMeaning;
  look: StorageAppearance;
  zones: ExportV2Zone[];
  /** What was stored but could not be read as it is, and so is written here as the app read it. */
  fallbacks: StorageFallback[];
}

export type ExportV2Bottle = CellrExport["bottles"][number] & {
  /** The bottle's index within its position (1 = the first). Null exactly when it has no place. */
  index: number | null;
};

export interface CellrExportV2 extends Omit<CellrExport, "version" | "places" | "bottles"> {
  version: typeof EXPORT_V2_VERSION;
  places: ExportV2Place[];
  bottles: ExportV2Bottle[];
}
