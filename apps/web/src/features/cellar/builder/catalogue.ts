import {
  STORAGE_TEMPLATES,
  STORAGE_TEMPLATE_IDS,
  structureCapacity,
  templateSavable,
  type StorageTemplate,
  type StorageTemplateId,
} from "@cellr/domain";

/**
 * The template catalogue as the builder shows it (sprint 3): the domain's fourteen templates, in groups a person
 * recognises, each with what is true of it. Nothing here is a second definition: groups follow from each
 * template's kind and family, and every fact on a card is read from STORAGE_TEMPLATES.
 */
export const TEMPLATE_GROUPS = ["racks", "shelving", "bins", "wall", "coolers", "other"] as const;
export type TemplateGroup = (typeof TEMPLATE_GROUPS)[number];

export function groupOf(t: StorageTemplate): TemplateGroup {
  if (t.family === "bins") return "bins";
  if (t.family === "wall") return "wall";
  if (t.kind === "fridge") return "coolers";
  if (t.kind === "shelving" || t.kind === "cabinet") return "shelving";
  if (t.kind === "rack") return "racks";
  return "other";
}

/** Every template, grouped, in catalogue order within each group. Every id appears exactly once. */
export function groupedTemplates(): Array<{ group: TemplateGroup; ids: StorageTemplateId[] }> {
  return TEMPLATE_GROUPS.map((group) => ({
    group,
    ids: STORAGE_TEMPLATE_IDS.filter((id) => groupOf(STORAGE_TEMPLATES[id]) === group),
  })).filter((g) => g.ids.length > 0);
}

/** What a card says about a template: all of it read from the catalogue. */
export interface CardFacts {
  /** Bottles as it comes out of the box. */
  capacity: number;
  /** How a spot holds bottles. */
  holds:
    | { kind: "single" }
    | { kind: "deep"; min: number; max: number }
    | { kind: "bins"; count: number };
  /** Temperature zones it can have (0: none). */
  zones: number;
  door: boolean;
  /** Can be saved in this version (one bottle per spot); otherwise a preview. */
  savable: boolean;
}

export function cardFacts(id: StorageTemplateId): CardFacts {
  const t = STORAGE_TEMPLATES[id];
  const holds: CardFacts["holds"] =
    t.family === "bins"
      ? { kind: "bins", count: t.cellCapacity.default }
      : t.cellCapacity.max > 1 && t.cellCapacity.min > 1
        ? { kind: "deep", min: t.cellCapacity.min, max: t.cellCapacity.max }
        : { kind: "single" };
  return {
    capacity: structureCapacity({
      rows: t.rows.default,
      cols: t.cols.default,
      cellCapacity: t.cellCapacity.default,
    }),
    holds,
    zones: t.zones?.max ?? 0,
    door: t.appearance.doors.some((d) => d !== "none"),
    savable: templateSavable(id),
  };
}

/** The still picture of a template on its card: made by the renderer itself, ahead of time (see the report). */
export const templateSnapshot = (id: StorageTemplateId) => `/builder/templates/${id}.jpg`;
