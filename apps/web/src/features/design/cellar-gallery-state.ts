import {
  STORAGE_PALETTES,
  STORAGE_TEMPLATES,
  STORAGE_TEMPLATE_IDS,
  defaultZones,
  isStorageTemplateId,
  resolveStorage,
  type ResolvedStorage,
  type StorageColor,
  type StorageDoor,
  type StorageLighting,
  type StorageMaterial,
  type StorageTemplateId,
  type StoredStorage,
} from "@cellr/domain";
import type { Fill } from "@/features/cellar/storage3d/fixtures";
import type { Quality } from "@/features/cellar/storage3d/model";

/**
 * What the template gallery (/design/cellar-3d) is showing, as plain data that fits in the address bar: a link to
 * the gallery is a link to one exact picture, which is what the screenshots and measurements are made from.
 * Everything is one of a fixed set or a clamped number: nothing typed into the address reaches the renderer raw.
 */
export const SAMPLES = ["template", "legacy", "unknown"] as const;
export type Sample = (typeof SAMPLES)[number];

/** Places whose arrangement the app cannot be sure of, as the database could hold them. */
export const UNKNOWN_CASES = {
  "unknown-template": {
    label: "A template this version does not know",
    stored: {
      kind: "rack",
      rows: 3,
      cols: 4,
      template: "hex_rack_2031",
      cellCapacity: 4,
      semantics: "depth",
    },
  },
  "kind-mismatch": {
    label: "A rack template stored on a wall place",
    stored: {
      kind: "wall",
      rows: 3,
      cols: 4,
      template: "rack_double_depth",
      cellCapacity: 2,
      semantics: "depth",
    },
  },
  "pegs-three-each": {
    label: "Wall pegs stored with three bottles each",
    stored: {
      kind: "wall",
      rows: 3,
      cols: 4,
      template: "wall_pegs",
      cellCapacity: 3,
      semantics: "single",
    },
  },
  "bins-as-depth": {
    label: "Diamond bins stored as depths",
    stored: {
      kind: "rack",
      rows: 2,
      cols: 3,
      template: "diamond_bins",
      cellCapacity: 8,
      semantics: "depth",
    },
  },
} as const satisfies Record<string, { label: string; stored: StoredStorage }>;
export type UnknownCase = keyof typeof UNKNOWN_CASES;

export const LEGACY_KINDS = ["rack", "fridge", "cabinet", "shelving", "wall", "other"] as const;
export type LegacyKind = (typeof LEGACY_KINDS)[number];

export interface GalleryState {
  sample: Sample;
  template: StorageTemplateId;
  rows: number;
  cols: number;
  cap: number;
  material: StorageMaterial;
  color: StorageColor;
  lighting: StorageLighting;
  door: StorageDoor;
  fill: Fill;
  quality: "auto" | Quality;
  unknown: UnknownCase;
  legacyKind: LegacyKind;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;
const num = (value: unknown, fallback: number) => {
  const n = typeof value === "string" && value !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

/**
 * A state the catalogue allows, from one that may not be: sizes inside the template's limits (and its largest
 * capacity), a look the template offers. Changing the template keeps what still fits and resets what does not.
 */
export function normalize(input: Partial<Record<keyof GalleryState, unknown>>): GalleryState {
  const template = isStorageTemplateId(input.template) ? input.template : STORAGE_TEMPLATE_IDS[0];
  const t = STORAGE_TEMPLATES[template];
  const sample = oneOf(input.sample, SAMPLES, "template");
  const legacy = sample === "legacy";
  const cap = legacy
    ? 1
    : clamp(
        num(String(input.cap ?? ""), t.cellCapacity.default),
        t.cellCapacity.min,
        t.cellCapacity.max,
      );
  const rows = clamp(num(String(input.rows ?? ""), t.rows.default), t.rows.min, t.rows.max);
  const most = Math.max(t.cols.min, Math.floor(t.maxCapacity / (rows * cap)));
  const cols = clamp(
    num(String(input.cols ?? ""), t.cols.default),
    t.cols.min,
    Math.min(t.cols.max, most),
  );
  const look = t.appearance;
  const material = oneOf(input.material, look.materials, look.default.material);
  const palette = STORAGE_PALETTES[material];
  return {
    sample,
    template,
    rows,
    cols,
    cap,
    material,
    color: oneOf(
      input.color,
      palette,
      material === look.default.material ? look.default.color : palette[0]!,
    ),
    lighting: oneOf(input.lighting, look.lighting, look.default.lighting),
    door: oneOf(input.door, look.doors, look.default.door),
    fill: oneOf(input.fill, ["empty", "partial", "full"] as const, "partial"),
    quality: oneOf(input.quality, ["auto", "high", "balanced", "low"] as const, "auto"),
    unknown: oneOf(input.unknown, Object.keys(UNKNOWN_CASES) as UnknownCase[], "unknown-template"),
    legacyKind: oneOf(input.legacyKind, LEGACY_KINDS, "rack"),
  };
}

/** The state as the query of a link, leaving out what is the default anyway. */
export function toQuery(state: GalleryState): string {
  const base = normalize({ template: state.template, sample: state.sample });
  const q = new URLSearchParams();
  for (const key of Object.keys(state) as Array<keyof GalleryState>)
    if (key === "template" || key === "sample" || state[key] !== base[key])
      q.set(key, String(state[key]));
  return q.toString();
}

/** The place the state describes, as the database would hold it, read back through the domain's own adapter. */
export function placeOf(state: GalleryState): ResolvedStorage {
  if (state.sample === "legacy")
    return resolveStorage({ kind: state.legacyKind, rows: state.rows, cols: state.cols });
  if (state.sample === "unknown") return resolveStorage(UNKNOWN_CASES[state.unknown].stored);
  const t = STORAGE_TEMPLATES[state.template];
  return resolveStorage({
    kind: t.kind,
    rows: state.rows,
    cols: state.cols,
    template: t.id,
    cellCapacity: state.cap,
    semantics: t.semantics,
    zones: t.zones ? defaultZones(t, state.rows) : undefined,
    appearance: {
      v: 1,
      material: state.material,
      color: state.color,
      lighting: state.lighting,
      door: state.door,
    },
  });
}
