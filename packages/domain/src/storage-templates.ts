import type { StorageKind } from "./cellar";

/**
 * THE STORAGE TEMPLATE CATALOGUE (Smart Cellar 3D, sprint 1A). A template is a named preset of one of a few layout
 * families: what a place for bottles is like (a wooden rack, diamond bins, a dual-zone cooler), how its spots are
 * counted, how large it may be and what it may look like. Templates are DATA: nothing here draws anything, and a
 * new template is a new entry, never a new rendering system.
 *
 * Add-only evolution: an id, once released, keeps its meaning for ever (it is stored with a place). A template may
 * gain options; it never loses one a stored place could be using. `kind` stays the coarse category the database
 * already knows (public.location_kind); the template is the finer choice next to it.
 */
export const STORAGE_CATALOG_VERSION = 1;

// ---- Vocabulary ---------------------------------------------------------------------------------------------------

/**
 * How a place is laid out, logically:
 * - `grid`: shelves of single bottle positions, possibly several bottles deep;
 * - `bins`: compartments that each hold a loose pile of bottles (cubes, diamond bins, crates);
 * - `wall`: bottles on pegs or rails on a wall, their labels towards you.
 */
export const LAYOUT_FAMILIES = ["grid", "bins", "wall"] as const;
export type LayoutFamily = (typeof LAYOUT_FAMILIES)[number];

/**
 * What the third coordinate of a spot (its `index` within a cell) MEANS. It is never the same thing everywhere:
 * - `depth`: a physical depth position. 1 is the front, the bottle you see; 2 lies behind it.
 * - `ordinal`: a counter within a compartment and nothing more. Bottles in a bin shift when one is taken out, so
 *   "the 4th bottle of bin B2" is not a place anyone can point at: only the compartment is, and how full it is.
 * - `single`: there is exactly one position (index 1) per cell.
 */
export const SLOT_SEMANTICS = ["depth", "ordinal", "single"] as const;
export type SlotSemantics = (typeof SLOT_SEMANTICS)[number];

/** What a temperature zone is for: keeping wine for years, or holding it at the temperature it is poured at. */
export const ZONE_PURPOSES = ["storage", "serving"] as const;
export type ZonePurpose = (typeof ZONE_PURPOSES)[number];

/** What the frame is made of: a preset of surface (grain, sheen), never a mesh or a texture file. */
export const STORAGE_MATERIALS = ["wood", "metal", "lacquer"] as const;
export type StorageMaterial = (typeof STORAGE_MATERIALS)[number];

/** Every colour a place can have, by name. The renderer owns the actual tones. */
export const STORAGE_COLORS = [
  "oak",
  "walnut",
  "mahogany",
  "ebony",
  "pine",
  "black",
  "graphite",
  "stainless",
  "brass",
  "white",
  "sage",
  "navy",
] as const;
export type StorageColor = (typeof STORAGE_COLORS)[number];

/** The colours each material comes in. A colour outside its material's palette is not a valid look. */
export const STORAGE_PALETTES: Readonly<Record<StorageMaterial, readonly StorageColor[]>> = {
  wood: ["oak", "walnut", "mahogany", "ebony", "pine"],
  metal: ["black", "graphite", "stainless", "brass"],
  lacquer: ["white", "black", "sage", "navy"],
};

export const STORAGE_LIGHTING = ["none", "warm", "cool"] as const;
export type StorageLighting = (typeof STORAGE_LIGHTING)[number];

export const STORAGE_DOORS = ["none", "glass", "solid"] as const;
export type StorageDoor = (typeof STORAGE_DOORS)[number];

// ---- Limits -------------------------------------------------------------------------------------------------------

/**
 * The hard ceilings for ANY place, whatever its template. `rows` and `cols` are the database's own
 * (cellar_locations.grid_rows / grid_cols between 1 and 30); the others are what sprint 1B has to enforce there too.
 * `capacity` bounds what one place can hold in total (what the app has to load, list and draw for it): the largest
 * place that exists today, 30 x 30 single positions, fits under it.
 */
export const STORAGE_LIMITS = {
  rows: 30,
  cols: 30,
  cellCapacity: 16,
  capacity: 1200,
  zones: 3,
} as const;

/** The temperatures a zone can be set to (degrees Celsius, in half degrees). A setting, never a measurement. */
export const ZONE_TEMP_C = { min: 3, max: 22, step: 0.5 } as const;

export interface DimensionLimit {
  min: number;
  max: number;
  default: number;
}

/** One zone of a template's default split: its share of the shelves (top to bottom) and what it starts set to. */
export interface ZonePreset {
  share: number;
  purpose: ZonePurpose;
  targetTempC: number;
}

/** The look of a place: four named choices. Everything else about how it is drawn belongs to the renderer. */
export interface StorageStyle {
  material: StorageMaterial;
  color: StorageColor;
  lighting: StorageLighting;
  door: StorageDoor;
}

export interface StorageTemplate {
  /** Stable for ever: stored with a place. Lower-case letters, digits and underscores. */
  id: StorageTemplateId;
  /** The existing coarse category this template belongs to (public.location_kind). */
  kind: StorageKind;
  family: LayoutFamily;
  /** What a spot's `index` means in this template. */
  semantics: SlotSemantics;
  /** Shelves (rows of cells). */
  rows: DimensionLimit;
  /** Cells per shelf. */
  cols: DimensionLimit;
  /** Positions per cell: how many bottles deep (`depth`), or how many a compartment holds (`ordinal`). */
  cellCapacity: DimensionLimit;
  /** The most bottles one place of this template may hold (never above STORAGE_LIMITS.capacity). */
  maxCapacity: number;
  /** Temperature zones, or null when this kind of place has none. */
  zones: { max: number; defaults: readonly ZonePreset[] } | null;
  appearance: {
    materials: readonly StorageMaterial[];
    lighting: readonly StorageLighting[];
    doors: readonly StorageDoor[];
    default: StorageStyle;
  };
}

// ---- The catalogue ------------------------------------------------------------------------------------------------

export const STORAGE_TEMPLATE_IDS = [
  "rack_classic",
  "rack_double_depth",
  "rack_metal",
  "shelving_open",
  "cabinet_closed",
  "cube_modular",
  "diamond_bins",
  "crate_storage",
  "wall_pegs",
  "wall_rails",
  "cooler_single",
  "cooler_dual",
  "cooler_undercounter",
  "rack_generic",
] as const;
export type StorageTemplateId = (typeof STORAGE_TEMPLATE_IDS)[number];

const limit = (min: number, max: number, def: number): DimensionLimit => ({
  min,
  max,
  default: def,
});
/** Any size the database allows today: for the templates existing places are read as (see storage-compat). */
const anyRows = (def: number) => limit(1, STORAGE_LIMITS.rows, def);
const anyCols = (def: number) => limit(1, STORAGE_LIMITS.cols, def);
const ONE = limit(1, 1, 1);

const WOOD_ONLY = ["wood"] as const;
const ALL_MATERIALS = STORAGE_MATERIALS;
const NO_LIGHT = ["none"] as const;
const WARM_LIGHT = ["none", "warm"] as const;
const ANY_LIGHT = STORAGE_LIGHTING;
const NO_DOOR = ["none"] as const;

/** A cooler's cabinet: a metal or lacquered shell, lit, behind a glass (or solid) door. */
const COOLER_LOOK = {
  materials: ["metal", "lacquer"],
  lighting: ANY_LIGHT,
  doors: ["glass", "solid"],
  default: { material: "metal", color: "graphite", lighting: "warm", door: "glass" },
} as const satisfies StorageTemplate["appearance"];

const TEMPLATES: readonly StorageTemplate[] = [
  {
    id: "rack_classic",
    kind: "rack",
    family: "grid",
    semantics: "depth",
    rows: anyRows(5),
    cols: anyCols(8),
    cellCapacity: ONE,
    maxCapacity: 900,
    zones: null,
    appearance: {
      materials: WOOD_ONLY,
      lighting: WARM_LIGHT,
      doors: NO_DOOR,
      default: { material: "wood", color: "walnut", lighting: "none", door: "none" },
    },
  },
  {
    id: "rack_double_depth",
    kind: "rack",
    family: "grid",
    semantics: "depth",
    rows: anyRows(5),
    cols: anyCols(8),
    cellCapacity: limit(2, 3, 2),
    maxCapacity: STORAGE_LIMITS.capacity,
    zones: null,
    appearance: {
      materials: ["wood", "metal"],
      lighting: WARM_LIGHT,
      doors: NO_DOOR,
      default: { material: "wood", color: "walnut", lighting: "none", door: "none" },
    },
  },
  {
    id: "rack_metal",
    kind: "rack",
    family: "grid",
    semantics: "depth",
    rows: anyRows(6),
    cols: anyCols(6),
    cellCapacity: limit(1, 2, 1),
    maxCapacity: STORAGE_LIMITS.capacity,
    zones: null,
    appearance: {
      materials: ["metal"],
      lighting: NO_LIGHT,
      doors: NO_DOOR,
      default: { material: "metal", color: "black", lighting: "none", door: "none" },
    },
  },
  {
    id: "shelving_open",
    kind: "shelving",
    family: "grid",
    semantics: "depth",
    rows: anyRows(4),
    cols: anyCols(6),
    cellCapacity: limit(1, 2, 1),
    maxCapacity: STORAGE_LIMITS.capacity,
    zones: null,
    appearance: {
      materials: ["wood", "lacquer"],
      lighting: WARM_LIGHT,
      doors: NO_DOOR,
      default: { material: "wood", color: "oak", lighting: "none", door: "none" },
    },
  },
  {
    id: "cabinet_closed",
    kind: "cabinet",
    family: "grid",
    semantics: "depth",
    rows: anyRows(4),
    cols: anyCols(6),
    cellCapacity: limit(1, 2, 1),
    maxCapacity: STORAGE_LIMITS.capacity,
    zones: null,
    appearance: {
      materials: ["wood", "lacquer"],
      lighting: WARM_LIGHT,
      doors: ["solid", "glass"],
      default: { material: "wood", color: "mahogany", lighting: "none", door: "solid" },
    },
  },
  {
    id: "cube_modular",
    kind: "shelving",
    family: "bins",
    semantics: "ordinal",
    rows: limit(1, 10, 3),
    cols: limit(1, 10, 3),
    cellCapacity: limit(2, 16, 9),
    maxCapacity: STORAGE_LIMITS.capacity,
    zones: null,
    appearance: {
      materials: ["wood", "lacquer"],
      lighting: WARM_LIGHT,
      doors: NO_DOOR,
      default: { material: "wood", color: "oak", lighting: "none", door: "none" },
    },
  },
  {
    id: "diamond_bins",
    kind: "rack",
    family: "bins",
    semantics: "ordinal",
    rows: limit(1, 10, 2),
    cols: limit(1, 10, 3),
    cellCapacity: limit(2, 16, 8),
    maxCapacity: STORAGE_LIMITS.capacity,
    zones: null,
    appearance: {
      materials: WOOD_ONLY,
      lighting: WARM_LIGHT,
      doors: NO_DOOR,
      default: { material: "wood", color: "walnut", lighting: "none", door: "none" },
    },
  },
  {
    id: "crate_storage",
    kind: "other",
    family: "bins",
    semantics: "ordinal",
    rows: limit(1, 10, 3),
    cols: limit(1, 10, 2),
    cellCapacity: limit(1, 12, 6),
    maxCapacity: STORAGE_LIMITS.capacity,
    zones: null,
    appearance: {
      materials: WOOD_ONLY,
      lighting: NO_LIGHT,
      doors: NO_DOOR,
      default: { material: "wood", color: "pine", lighting: "none", door: "none" },
    },
  },
  {
    id: "wall_pegs",
    kind: "wall",
    family: "wall",
    semantics: "single",
    rows: anyRows(6),
    cols: anyCols(6),
    cellCapacity: ONE,
    maxCapacity: 900,
    zones: null,
    appearance: {
      materials: ["metal", "wood"],
      lighting: NO_LIGHT,
      doors: NO_DOOR,
      default: { material: "metal", color: "black", lighting: "none", door: "none" },
    },
  },
  {
    // Rails come one, two or three bottles deep: the one wall template that defines more than position 1.
    id: "wall_rails",
    kind: "wall",
    family: "wall",
    semantics: "depth",
    rows: limit(1, 30, 9),
    cols: limit(1, 8, 1),
    cellCapacity: limit(1, 3, 1),
    maxCapacity: 720,
    zones: null,
    appearance: {
      materials: ["metal"],
      lighting: NO_LIGHT,
      doors: NO_DOOR,
      default: { material: "metal", color: "black", lighting: "none", door: "none" },
    },
  },
  {
    id: "cooler_single",
    kind: "fridge",
    family: "grid",
    semantics: "depth",
    rows: anyRows(5),
    cols: anyCols(4),
    cellCapacity: limit(1, 2, 1),
    maxCapacity: STORAGE_LIMITS.capacity,
    zones: { max: 1, defaults: [{ share: 1, purpose: "storage", targetTempC: 12 }] },
    appearance: COOLER_LOOK,
  },
  {
    id: "cooler_dual",
    kind: "fridge",
    family: "grid",
    semantics: "depth",
    rows: limit(2, 20, 8),
    cols: limit(1, 12, 5),
    cellCapacity: limit(1, 2, 1),
    maxCapacity: 480,
    zones: {
      max: 2,
      defaults: [
        { share: 0.5, purpose: "serving", targetTempC: 8 },
        { share: 0.5, purpose: "storage", targetTempC: 12 },
      ],
    },
    appearance: COOLER_LOOK,
  },
  {
    id: "cooler_undercounter",
    kind: "fridge",
    family: "grid",
    semantics: "depth",
    rows: limit(1, 8, 6),
    cols: limit(1, 8, 4),
    cellCapacity: limit(1, 2, 1),
    maxCapacity: 128,
    zones: { max: 2, defaults: [{ share: 1, purpose: "storage", targetTempC: 12 }] },
    appearance: COOLER_LOOK,
  },
  {
    id: "rack_generic",
    kind: "other",
    family: "grid",
    semantics: "depth",
    rows: anyRows(4),
    cols: anyCols(6),
    cellCapacity: limit(1, 3, 1),
    maxCapacity: STORAGE_LIMITS.capacity,
    zones: null,
    appearance: {
      materials: ALL_MATERIALS,
      lighting: ANY_LIGHT,
      doors: NO_DOOR,
      default: { material: "wood", color: "walnut", lighting: "none", door: "none" },
    },
  },
];

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** Every template by id. Frozen all the way down: the catalogue is read, never changed, at run time. */
export const STORAGE_TEMPLATES: Readonly<Record<StorageTemplateId, StorageTemplate>> =
  /* @__PURE__ */ deepFreeze(
    Object.fromEntries(TEMPLATES.map((t) => [t.id, t])) as Record<
      StorageTemplateId,
      StorageTemplate
    >,
  );

export const isStorageTemplateId = (value: unknown): value is StorageTemplateId =>
  typeof value === "string" && Object.hasOwn(STORAGE_TEMPLATES, value);

/** The template with this id, or null for anything else (an id from a newer version of the app, a typo). */
export const getStorageTemplate = (id: unknown): StorageTemplate | null =>
  isStorageTemplateId(id) ? STORAGE_TEMPLATES[id] : null;

/**
 * The template a place is read as when it has none of its own: every place made before templates existed. Each
 * accepts every size the database allows and one position per cell, so no existing place is ever out of range.
 */
export const DEFAULT_TEMPLATE_FOR_KIND: Readonly<Record<StorageKind, StorageTemplateId>> = {
  rack: "rack_classic",
  fridge: "cooler_single",
  cabinet: "cabinet_closed",
  shelving: "shelving_open",
  wall: "wall_pegs",
  other: "rack_generic",
};

/** The templates of one kind, in catalogue order. */
export const templatesForKind = (kind: StorageKind): StorageTemplate[] =>
  STORAGE_TEMPLATE_IDS.map((id) => STORAGE_TEMPLATES[id]).filter((t) => t.kind === kind);
