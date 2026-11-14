import { z } from "zod";
import { uniformLayout, type LogicalLayout } from "./storage-layout";
import {
  STORAGE_COLORS,
  STORAGE_DOORS,
  STORAGE_LIGHTING,
  STORAGE_LIMITS,
  STORAGE_MATERIALS,
  STORAGE_PALETTES,
  STORAGE_TEMPLATE_IDS,
  STORAGE_TEMPLATES,
  ZONE_PURPOSES,
  ZONE_TEMP_C,
  getStorageTemplate,
  type StorageStyle,
  type StorageTemplate,
  type StorageTemplateId,
} from "./storage-templates";

/**
 * WHAT A PLACE IS CONFIGURED AS (Smart Cellar 3D, sprint 1A), in two parts that never mix:
 *
 * - STRUCTURE: the template, its size, how many bottles a cell holds, its temperature zones. It decides which
 *   spots exist, so it is checked on the server and (from sprint 1B) by the database. Only whole numbers and named
 *   choices: every rule here can be written as a database constraint.
 * - APPEARANCE: material, colour, lighting, door. It decides nothing but the picture. Named presets only: no
 *   measurements, no colours typed in, no meshes, nothing that is run.
 *
 * Writing is strict (these schemas refuse anything unknown, out of range or unsupported by the template).
 * Reading is forgiving (see storage-compat): what is stored is shown as well as it can be, never thrown away.
 */

// ---- Structure ----------------------------------------------------------------------------------------------------

/** A zone's shelves (top to bottom, both ends included), what it is for and what it is SET to. Never a reading. */
export const StorageZoneSchema = z.strictObject({
  fromRow: z.number().int().min(1).max(STORAGE_LIMITS.rows),
  toRow: z.number().int().min(1).max(STORAGE_LIMITS.rows),
  purpose: z.enum(ZONE_PURPOSES),
  /** The temperature the owner says the zone is set to (°C, half degrees), or null when they have not said. */
  targetTempC: z
    .number()
    .min(ZONE_TEMP_C.min)
    .max(ZONE_TEMP_C.max)
    .multipleOf(ZONE_TEMP_C.step)
    .nullable(),
});
export type StorageZone = z.infer<typeof StorageZoneSchema>;

/** What is wrong with a set of zones for a place of `rows` shelves, or null when they are sound. */
export type ZoneProblem = "not_supported" | "too_many" | "not_a_split";

/**
 * Zones are a SPLIT of the shelves: the first starts at shelf 1, each next one starts right under the one before,
 * the last ends at the bottom shelf. So every shelf is in exactly one zone, with no gap and no overlap. No zones at
 * all is always sound ("not set up"); a template without zones takes none.
 */
export function checkZones(
  template: StorageTemplate,
  rows: number,
  zones: readonly Pick<StorageZone, "fromRow" | "toRow">[],
): ZoneProblem | null {
  if (zones.length === 0) return null;
  if (!template.zones) return "not_supported";
  if (zones.length > template.zones.max) return "too_many";
  let next = 1;
  for (const zone of zones) {
    if (zone.fromRow !== next || zone.toRow < zone.fromRow) return "not_a_split";
    next = zone.toRow + 1;
  }
  return next === rows + 1 ? null : "not_a_split";
}

/** The zone a shelf belongs to, or null when the place has no zones (or the shelf is not one of its). */
export const zoneOfRow = <Z extends Pick<StorageZone, "fromRow" | "toRow">>(
  zones: readonly Z[],
  row: number,
): Z | null => zones.find((z) => row >= z.fromRow && row <= z.toRow) ?? null;

/**
 * The structure of a place, as it may be WRITTEN. Refused: an unknown template, a size outside what the template
 * supports, more bottles than it may hold, zones it does not have or that do not split its shelves.
 */
export const StorageStructureSchema = z
  .strictObject({
    template: z.enum(STORAGE_TEMPLATE_IDS),
    /** Shelves. */
    rows: z.number().int().min(1).max(STORAGE_LIMITS.rows),
    /** Cells per shelf. */
    cols: z.number().int().min(1).max(STORAGE_LIMITS.cols),
    /** Bottles per cell: how deep (a rack), or how many a compartment holds (a bin). */
    cellCapacity: z.number().int().min(1).max(STORAGE_LIMITS.cellCapacity),
    zones: z.array(StorageZoneSchema).max(STORAGE_LIMITS.zones).default([]),
  })
  .superRefine((s, ctx) => {
    // Only a known template has limits to hold the rest against (an unknown one is already refused above).
    const template = getStorageTemplate(s.template);
    if (!template) return;
    for (const field of ["rows", "cols", "cellCapacity"] as const) {
      const { min, max } = template[field];
      if (s[field] < min || s[field] > max)
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `This kind of place takes ${min} to ${max} here.`,
        });
    }
    if (s.rows * s.cols * s.cellCapacity > template.maxCapacity)
      ctx.addIssue({
        code: "custom",
        path: ["rows"],
        message: `This kind of place holds at most ${template.maxCapacity} bottles.`,
      });
    const problem = checkZones(template, s.rows, s.zones);
    if (problem)
      ctx.addIssue({
        code: "custom",
        path: ["zones"],
        message:
          problem === "not_supported"
            ? "This kind of place has no temperature zones."
            : problem === "too_many"
              ? "This kind of place has fewer temperature zones."
              : "The zones must cover every shelf once, from top to bottom.",
      });
  });
export type StorageStructure = z.infer<typeof StorageStructureSchema>;

/** How many bottles a structure holds. */
export const structureCapacity = (
  s: Pick<StorageStructure, "rows" | "cols" | "cellCapacity">,
): number => s.rows * s.cols * s.cellCapacity;

/** The logical layout of a structure: its template's family and slot semantics over its own size. */
export function layoutOfStructure(
  s: Pick<StorageStructure, "template" | "rows" | "cols" | "cellCapacity">,
): LogicalLayout {
  const { family, semantics } = STORAGE_TEMPLATES[s.template];
  return uniformLayout({
    family,
    semantics,
    rows: s.rows,
    cols: s.cols,
    cellCapacity: s.cellCapacity,
  });
}

/**
 * A template's default zones over `rows` shelves: its presets' shares of the shelves, top to bottom, every zone at
 * least one shelf. With fewer shelves than presets the last presets are left out. A template without zones gives none.
 */
export function defaultZones(template: StorageTemplate, rows: number): StorageZone[] {
  if (!template.zones || !Number.isInteger(rows) || rows < 1) return [];
  const presets = template.zones.defaults.slice(0, rows);
  const total = presets.reduce((sum, p) => sum + p.share, 0);
  const zones: StorageZone[] = [];
  let from = 1;
  let shareSoFar = 0;
  presets.forEach((preset, i) => {
    shareSoFar += preset.share;
    const last = i === presets.length - 1;
    // the shelf this zone ends on: its share of the whole, but leaving one shelf for every zone still to come
    const ideal = Math.round((shareSoFar / total) * rows);
    const to = last ? rows : Math.min(Math.max(ideal, from), rows - (presets.length - 1 - i));
    zones.push({
      fromRow: from,
      toRow: to,
      purpose: preset.purpose,
      targetTempC: preset.targetTempC,
    });
    from = to + 1;
  });
  return zones;
}

/** A template as it comes out of the box: its default size, one cell capacity, its default zones. */
export function defaultStructure(id: StorageTemplateId): StorageStructure {
  const template = STORAGE_TEMPLATES[id];
  return {
    template: id,
    rows: template.rows.default,
    cols: template.cols.default,
    cellCapacity: template.cellCapacity.default,
    zones: defaultZones(template, template.rows.default),
  };
}

// ---- Appearance ---------------------------------------------------------------------------------------------------

/** The version appearances are written in today. A stored appearance of any other version is not read (see below). */
export const STORAGE_APPEARANCE_VERSION = 1;

/** The look of a place, as it may be WRITTEN: this version, four named choices, a colour of its material. */
export const StorageAppearanceSchema = z
  .strictObject({
    v: z.literal(STORAGE_APPEARANCE_VERSION),
    material: z.enum(STORAGE_MATERIALS),
    color: z.enum(STORAGE_COLORS),
    lighting: z.enum(STORAGE_LIGHTING),
    door: z.enum(STORAGE_DOORS),
  })
  .refine((a) => STORAGE_PALETTES[a.material].includes(a.color), {
    path: ["color"],
    message: "That colour does not come in this material.",
  });
export type StorageAppearance = z.infer<typeof StorageAppearanceSchema>;

/** The parts of a look this template does not offer (empty when it offers all of it). */
export function unsupportedStyle(
  template: StorageTemplate,
  style: StorageStyle,
): Array<keyof StorageStyle> {
  const out: Array<keyof StorageStyle> = [];
  if (!template.appearance.materials.includes(style.material)) out.push("material");
  if (!STORAGE_PALETTES[style.material].includes(style.color)) out.push("color");
  if (!template.appearance.lighting.includes(style.lighting)) out.push("lighting");
  if (!template.appearance.doors.includes(style.door)) out.push("door");
  return out;
}

export function defaultAppearance(id: StorageTemplateId): StorageAppearance {
  return { v: STORAGE_APPEARANCE_VERSION, ...STORAGE_TEMPLATES[id].appearance.default };
}

/**
 * A stored appearance, read for a template. Never throws and never guesses:
 * - not an appearance of the version this app writes (another version, missing, malformed, extra keys): the
 *   template's default, whole. A newer app's look is not half-understood by an older one.
 * - this version, but with a choice the template does not offer: that choice alone becomes the template's default
 *   (a material the template lacks takes its colour with it).
 * `source` says which: "stored" (used as it is), "adjusted", or "default".
 */
export function readAppearance(
  id: StorageTemplateId,
  stored: unknown,
): { appearance: StorageAppearance; source: "stored" | "adjusted" | "default" } {
  const template = STORAGE_TEMPLATES[id];
  const fallback = defaultAppearance(id);
  const parsed = StorageAppearanceSchema.safeParse(stored);
  if (!parsed.success) return { appearance: fallback, source: "default" };
  const wrong = unsupportedStyle(template, parsed.data);
  if (wrong.length === 0) return { appearance: parsed.data, source: "stored" };
  const appearance = { ...parsed.data };
  if (wrong.includes("material")) {
    appearance.material = fallback.material;
    appearance.color = fallback.color;
  }
  if (wrong.includes("lighting")) appearance.lighting = fallback.lighting;
  if (wrong.includes("door")) appearance.door = fallback.door;
  return { appearance, source: "adjusted" };
}

// ---- The whole configuration ------------------------------------------------------------------------------------------

/**
 * Structure and appearance together, as a create or an edit may send them. On top of each part's own rules, the
 * look must be one the template offers.
 */
export const StorageConfigSchema = z
  .strictObject({
    structure: StorageStructureSchema,
    appearance: StorageAppearanceSchema,
  })
  .superRefine((config, ctx) => {
    const template = getStorageTemplate(config.structure.template);
    if (!template) return;
    for (const field of unsupportedStyle(template, config.appearance))
      ctx.addIssue({
        code: "custom",
        path: ["appearance", field],
        message: "This kind of place does not come like that.",
      });
  });
export type StorageConfig = z.infer<typeof StorageConfigSchema>;

export const defaultStorageConfig = (id: StorageTemplateId): StorageConfig => ({
  structure: defaultStructure(id),
  appearance: defaultAppearance(id),
});
