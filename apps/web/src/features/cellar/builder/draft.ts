import {
  CreateStorageSchema,
  STORAGE_LIMITS,
  STORAGE_PALETTES,
  StorageAppearanceSchema,
  StorageZoneSchema,
  STORAGE_TEMPLATES,
  StorageConfigSchema,
  cellCapacitySavableWith,
  checkZones,
  defaultStorageConfig,
  defaultZones,
  isStorageTemplateId,
  layoutChangeProblem,
  readAppearance,
  sameRevision,
  resolveStorage,
  structureCapacity,
  templateSavableWith,
  type LayoutChangeProblem,
  type OccupiedSpot,
  type ResolvedStorage,
  type SmartStorageUnitView,
  type StorageAppearance,
  type StorageColor,
  type StorageConfig,
  type StorageDoor,
  type StorageLighting,
  type StorageMaterial,
  type StorageTemplate,
  type StorageTemplateId,
  type StorageZone,
  type ZonePurpose,
} from "@cellr/domain";

/**
 * THE RACK BUILDER'S DRAFT (Smart Cellar 3D, sprint 3): what the person is designing, apart from what is saved.
 * Pure functions only, and no rule of its own: every limit, palette, default and check is the domain's
 * (packages/domain: storage-templates, storage-config, smart-cellar). What this file adds is how a draft follows a
 * change (a new material keeps its colour when it can), and a plain account of whether the draft can be saved.
 */
export interface BuilderDraft {
  name: string;
  template: StorageTemplateId;
  rows: number;
  cols: number;
  cellCapacity: number;
  appearance: StorageAppearance;
  /** Top zone first. Empty: no zones set up. */
  zones: StorageZone[];
  /**
   * Whether the template is the person's choice. False while it is only a suggestion: an existing place from
   * before templates (its kind's default is suggested), or one whose stored template this app cannot read. Such a
   * draft cannot be saved until a template has been chosen, so opening a place never decides what it is.
   */
  templateChosen: boolean;
}

export type Dimension = "rows" | "cols" | "cellCapacity";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// ---- Starting points ------------------------------------------------------------------------------------------------

/** A new place of a template, exactly as it comes out of the box (the domain's defaults, nothing adjusted). */
export function draftFromTemplate(id: StorageTemplateId, name = ""): BuilderDraft {
  const config = defaultStorageConfig(id);
  return {
    name,
    template: id,
    rows: config.structure.rows,
    cols: config.structure.cols,
    cellCapacity: config.structure.cellCapacity,
    appearance: config.appearance,
    zones: config.structure.zones,
    templateChosen: true,
  };
}

/**
 * An existing place as a draft: exactly what is stored (never narrowed). The template is the stored one when the app
 * knows the arrangement; otherwise the kind's default stands in as a SUGGESTION (`templateChosen: false`).
 */
export function draftFromUnit(unit: SmartStorageUnitView): BuilderDraft {
  const known =
    !unit.legacy && unit.arrangementKnown && isStorageTemplateId(unit.templateId)
      ? unit.templateId
      : null;
  return {
    name: unit.label,
    template: known ?? unit.layoutTemplateId,
    rows: unit.rows,
    cols: unit.cols,
    cellCapacity: unit.cellCapacity,
    appearance: unit.appearance,
    zones: unit.zones.map((z) => ({ ...z })),
    templateChosen: known !== null,
  };
}

// ---- Changes ----------------------------------------------------------------------------------------------------------

/** What a change reconciled on its own, so it can be said (never done silently). */
export type Reconciled = "color" | "material" | "lighting" | "door" | "zones" | "size";

export interface Change {
  draft: BuilderDraft;
  reconciled: Reconciled[];
}

/** The smallest and largest value a dimension can take now: the template's limit, and its capacity with the others. */
export function dimensionRange(
  draft: BuilderDraft,
  field: Dimension,
): { min: number; max: number } {
  const template = STORAGE_TEMPLATES[draft.template];
  const { min, max } = template[field];
  const others =
    field === "rows"
      ? draft.cols * draft.cellCapacity
      : field === "cols"
        ? draft.rows * draft.cellCapacity
        : draft.rows * draft.cols;
  const byCapacity = Math.floor(template.maxCapacity / Math.max(1, others));
  return { min, max: Math.max(min, Math.min(max, byCapacity)) };
}

/**
 * Zones over a new number of shelves: the same zones (purpose, set temperature), the same proportions, every zone at
 * least one shelf; when there are fewer shelves than zones, the last ones go. The result always splits the shelves.
 */
export function rezone(
  template: StorageTemplate,
  zones: readonly StorageZone[],
  rows: number,
): StorageZone[] {
  if (zones.length === 0 || !template.zones) return [];
  const oldRows = zones[zones.length - 1]!.toRow;
  const kept = zones.slice(0, Math.min(zones.length, rows, template.zones.max));
  const out: StorageZone[] = [];
  let from = 1;
  kept.forEach((zone, i) => {
    const last = i === kept.length - 1;
    const ideal = Math.round((zone.toRow / Math.max(1, oldRows)) * rows);
    const to = last ? rows : clamp(ideal, from, rows - (kept.length - 1 - i));
    out.push({ ...zone, fromRow: from, toRow: to });
    from = to + 1;
  });
  return checkZones(template, rows, out) === null ? out : defaultZones(template, rows);
}

export function setDimension(draft: BuilderDraft, field: Dimension, value: number): Change {
  const { min, max } = dimensionRange(draft, field);
  const next = { ...draft, [field]: clamp(Math.round(value), min, max) };
  if (field !== "rows" || next.rows === draft.rows) return { draft: next, reconciled: [] };
  const zones = rezone(STORAGE_TEMPLATES[draft.template], draft.zones, next.rows);
  const moved =
    zones.length !== draft.zones.length || zones.some((z, i) => z.toRow !== draft.zones[i]?.toRow);
  return {
    draft: { ...next, zones },
    reconciled: moved && draft.zones.length > 0 ? ["zones"] : [],
  };
}

/**
 * Another template. A new place takes the template's defaults whole (size, bottles per cell, look, zones): what the
 * card promised. An existing place keeps its size where the template allows it (its bottles are where they are;
 * a size the template cannot take is brought inside its limits, and any bottle that leaves is shown as a blocker,
 * never moved), and keeps whatever of its look the template offers. Bottles per cell become the template's own:
 * a template that needs more than one is not quietly saved as one (it stays a preview).
 */
export function chooseTemplate(
  draft: BuilderDraft,
  id: StorageTemplateId,
  mode: "new" | "edit",
): Change {
  const template = STORAGE_TEMPLATES[id];
  if (mode === "new") {
    const fresh = draftFromTemplate(id, draft.name);
    return { draft: fresh, reconciled: [] };
  }
  const reconciled: Reconciled[] = [];
  const rows = clamp(draft.rows, template.rows.min, template.rows.max);
  const cols = clamp(draft.cols, template.cols.min, template.cols.max);
  if (rows !== draft.rows || cols !== draft.cols) reconciled.push("size");
  const cellCapacity = clamp(
    draft.cellCapacity,
    template.cellCapacity.min,
    template.cellCapacity.max,
  );
  const look = readAppearance(id, draft.appearance);
  if (look.source !== "stored") {
    const a = look.appearance;
    const b = draft.appearance;
    if (a.material !== b.material) reconciled.push("material");
    if (a.color !== b.color) reconciled.push("color");
    if (a.lighting !== b.lighting) reconciled.push("lighting");
    if (a.door !== b.door) reconciled.push("door");
  }
  const zones = template.zones ? defaultZones(template, rows) : [];
  let next: BuilderDraft = {
    ...draft,
    template: id,
    rows,
    cols,
    cellCapacity,
    appearance: look.appearance,
    zones,
    templateChosen: true,
  };
  // the template's own capacity ceiling: shrink the columns, then the shelves, until it fits (said, never hidden)
  while (structureCapacity(next) > template.maxCapacity && next.cols > template.cols.min)
    next = { ...next, cols: next.cols - 1 };
  while (structureCapacity(next) > template.maxCapacity && next.rows > template.rows.min)
    next = {
      ...next,
      rows: next.rows - 1,
      zones: template.zones ? defaultZones(template, next.rows - 1) : [],
    };
  if ((next.rows !== rows || next.cols !== cols) && !reconciled.includes("size"))
    reconciled.push("size");
  return { draft: next, reconciled };
}

/** A material: its colour stays when the material comes in it, otherwise the template's own, otherwise the first. */
export function setMaterial(draft: BuilderDraft, material: StorageMaterial): Change {
  const template = STORAGE_TEMPLATES[draft.template];
  if (!template.appearance.materials.includes(material)) return { draft, reconciled: [] };
  const palette = STORAGE_PALETTES[material];
  const keep = palette.includes(draft.appearance.color);
  const fallback = palette.includes(template.appearance.default.color)
    ? template.appearance.default.color
    : palette[0]!;
  const color: StorageColor = keep ? draft.appearance.color : fallback;
  return {
    draft: { ...draft, appearance: { ...draft.appearance, material, color } },
    reconciled: keep ? [] : ["color"],
  };
}

/** A colour of the current material (anything else is ignored: the swatches only offer those). */
export const setColor = (draft: BuilderDraft, color: StorageColor): BuilderDraft =>
  STORAGE_PALETTES[draft.appearance.material].includes(color)
    ? { ...draft, appearance: { ...draft.appearance, color } }
    : draft;

export const setLighting = (draft: BuilderDraft, lighting: StorageLighting): BuilderDraft =>
  STORAGE_TEMPLATES[draft.template].appearance.lighting.includes(lighting)
    ? { ...draft, appearance: { ...draft.appearance, lighting } }
    : draft;

export const setDoor = (draft: BuilderDraft, door: StorageDoor): BuilderDraft =>
  STORAGE_TEMPLATES[draft.template].appearance.doors.includes(door)
    ? { ...draft, appearance: { ...draft.appearance, door } }
    : draft;

/** How many zones (0: none set up). The template's default split for that many, kept to its maximum. */
export function setZoneCount(draft: BuilderDraft, count: number): BuilderDraft {
  const template = STORAGE_TEMPLATES[draft.template];
  if (!template.zones) return { ...draft, zones: [] };
  const n = clamp(Math.round(count), 0, Math.min(template.zones.max, draft.rows));
  if (n === 0) return { ...draft, zones: [] };
  if (n === draft.zones.length) return draft;
  // the template's presets for that many zones, or (a template whose presets have fewer) the last preset repeated
  const presets = template.zones.defaults;
  const like: StorageTemplate = {
    ...template,
    zones: {
      max: template.zones.max,
      defaults: Array.from({ length: n }, (_, i) => presets[Math.min(i, presets.length - 1)]!).map(
        (p) => ({ ...p, share: 1 / n }),
      ),
    },
  };
  return { ...draft, zones: defaultZones(like, draft.rows) };
}

/** Where the first zone ends (two zones): every shelf in exactly one zone, each zone at least one shelf. */
export function setZoneSplit(draft: BuilderDraft, lastShelfOfFirst: number): BuilderDraft {
  if (draft.zones.length !== 2) return draft;
  const to = clamp(Math.round(lastShelfOfFirst), 1, draft.rows - 1);
  const [a, b] = draft.zones as [StorageZone, StorageZone];
  return {
    ...draft,
    zones: [
      { ...a, toRow: to },
      { ...b, fromRow: to + 1, toRow: draft.rows },
    ],
  };
}

export function setZonePurpose(
  draft: BuilderDraft,
  index: number,
  purpose: ZonePurpose,
): BuilderDraft {
  return {
    ...draft,
    zones: draft.zones.map((z, i) => (i === index ? { ...z, purpose } : z)),
  };
}

/** The temperature a zone is SET to (half degrees), or null: not said. Never a reading. */
export function setZoneTemp(
  draft: BuilderDraft,
  index: number,
  value: number | null,
): BuilderDraft {
  return {
    ...draft,
    zones: draft.zones.map((z, i) =>
      i === index ? { ...z, targetTempC: value === null ? null : Math.round(value * 2) / 2 } : z,
    ),
  };
}

// ---- What the draft is ---------------------------------------------------------------------------------------------

/** The draft as the configuration a save sends: exactly what the domain's schema accepts (or not). */
export const toConfig = (draft: BuilderDraft): StorageConfig => ({
  structure: {
    template: draft.template,
    rows: draft.rows,
    cols: draft.cols,
    cellCapacity: draft.cellCapacity,
    zones: draft.zones,
  },
  appearance: draft.appearance,
});

/** The draft read back through the domain, as the database would hold it once saved: what the preview draws. */
export function resolvedOfDraft(draft: BuilderDraft): ResolvedStorage {
  const t = STORAGE_TEMPLATES[draft.template];
  return resolveStorage({
    kind: t.kind,
    rows: draft.rows,
    cols: draft.cols,
    template: t.id,
    cellCapacity: draft.cellCapacity,
    semantics: t.semantics,
    zones: draft.zones,
    appearance: draft.appearance,
  });
}

/** Why a draft cannot be saved, in the order they are worth saying. */
export type SaveProblem =
  | { kind: "no_template" }
  | { kind: "name" }
  /** More than one bottle per cell: preview only in this version. */
  | { kind: "preview_only"; templateNeedsDepth: boolean }
  /** The domain's schema refuses it (a size, a look, zones); `paths` says where. */
  | { kind: "invalid"; paths: string[] }
  /** The safety rules for the bottles already there. */
  | { kind: "layout"; problem: LayoutChangeProblem };

export interface Assessment {
  capacity: number;
  occupied: number;
  free: number;
  /** Capacity compared with the place as stored (0 for a new place). */
  delta: number;
  problems: SaveProblem[];
  /** True when nothing stands in the way of saving (the server and the database still decide). */
  savable: boolean;
}

/** The place as stored, for an existing place; null for a new one. */
export interface CurrentPlace {
  rows: number;
  cols: number;
  cellCapacity: number;
  semantics: string | null;
  capacity: number;
}

export function assess(
  draft: BuilderDraft,
  current: CurrentPlace | null,
  occupied: readonly OccupiedSpot[],
  /**
   * Whether the server says depth is open here (capabilities `depthPlacement`, sprint 9). False everywhere today;
   * the UI half passes it through (SPRINT-9-DEPTH-REPORT §8). Only then is more than one bottle per spot savable.
   */
  depthEnabled = false,
): Assessment {
  const capacity = structureCapacity(draft);
  const problems: SaveProblem[] = [];
  if (!draft.templateChosen) problems.push({ kind: "no_template" });
  // the name as the existing create and rename accept it (one schema, not a second rule)
  if (!CreateStorageSchema.shape.label.safeParse(draft.name).success)
    problems.push({ kind: "name" });
  if (!cellCapacitySavableWith(draft.cellCapacity, depthEnabled))
    problems.push({
      kind: "preview_only",
      templateNeedsDepth: !templateSavableWith(draft.template, depthEnabled),
    });
  const parsed = StorageConfigSchema.safeParse(toConfig(draft));
  if (!parsed.success)
    problems.push({
      kind: "invalid",
      paths: [...new Set(parsed.error.issues.map((i) => i.path.join(".")))],
    });
  const layout = layoutChangeProblem(
    current
      ? {
          rows: current.rows,
          cols: current.cols,
          cellCapacity: current.cellCapacity,
          semantics: current.semantics,
        }
      : { rows: draft.rows, cols: draft.cols, cellCapacity: 1, semantics: null },
    toConfig(draft).structure,
    occupied,
    { depthEnabled },
  );
  // depth is already said above, plainly; the rest are the bottles' own rules
  if (layout && layout !== "depth_not_enabled") problems.push({ kind: "layout", problem: layout });
  return {
    capacity,
    occupied: occupied.length,
    free: Math.max(0, capacity - occupied.length),
    delta: current ? capacity - current.capacity : 0,
    problems,
    savable: problems.length === 0,
  };
}

/** The bottles a draft would leave without a spot (they block the save; nothing moves them). */
export function strandedBy<T extends OccupiedSpot>(
  draft: BuilderDraft,
  occupied: readonly T[],
): T[] {
  return occupied.filter(
    (s) => s.row > draft.rows || s.col > draft.cols || s.index > draft.cellCapacity,
  );
}

// ---- Revisions ----------------------------------------------------------------------------------------------------

/**
 * Whether `candidate` is another version of the place than `known` (null: none known yet). EQUALITY ONLY, to the
 * microsecond and whatever the offset (`sameRevision`): revisions are transaction start times, so "later" cannot be
 * read from them (the writer that committed last can have the smaller one). Anything different is news: the screen
 * takes it, or says the place changed, and a save is then checked by the database against the latest revision.
 */
export function isNewerRevision(candidate: string, known: string | null): boolean {
  return known === null || !sameRevision(candidate, known);
}

/**
 * Whether a place as the server answered after a layout save is what this draft saved (template, size, bottles per
 * spot, look, zones; the name is saved apart). When it is not, someone else's write landed in between and the
 * revision in that answer is theirs, not this save's.
 */
export function savedAsDrafted(draft: BuilderDraft, saved: SmartStorageUnitView): boolean {
  const after = draftFromUnit(saved);
  return (
    changesBetween({ ...draft, name: after.name }, { ...after, templateChosen: true }).length === 0
  );
}

// ---- Remembered drafts ----------------------------------------------------------------------------------------------

/**
 * A draft read back from the browser's memory, or null when it is not one this version can hold. Nothing read there
 * reaches the domain's functions unchecked: a known template, whole numbers within the database's limits, a look and
 * zones of the shapes the domain writes. (Whether the template takes them is assess()'s, as for any draft.)
 */
export function parseDraft(value: unknown): BuilderDraft | null {
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  const whole = (n: unknown, max: number) =>
    typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= max;
  if (!isStorageTemplateId(d.template)) return null;
  if (typeof d.name !== "string" || d.name.length > 200) return null;
  if (!whole(d.rows, STORAGE_LIMITS.rows) || !whole(d.cols, STORAGE_LIMITS.cols)) return null;
  if (!whole(d.cellCapacity, STORAGE_LIMITS.cellCapacity)) return null;
  if (typeof d.templateChosen !== "boolean") return null;
  const appearance = StorageAppearanceSchema.safeParse(d.appearance);
  const zones = StorageZoneSchema.array().max(STORAGE_LIMITS.zones).safeParse(d.zones);
  if (!appearance.success || !zones.success) return null;
  return {
    name: d.name,
    template: d.template,
    rows: d.rows as number,
    cols: d.cols as number,
    cellCapacity: d.cellCapacity as number,
    appearance: appearance.data,
    zones: zones.data,
    templateChosen: d.templateChosen,
  };
}

// ---- Comparing ------------------------------------------------------------------------------------------------------

export type ChangeKind = "name" | "template" | "size" | "cellCapacity" | "look" | "zones";

/** What differs between two drafts, in the terms a confirmation names. Empty: nothing changed. */
export function changesBetween(before: BuilderDraft, after: BuilderDraft): ChangeKind[] {
  const out: ChangeKind[] = [];
  if (before.name.trim() !== after.name.trim()) out.push("name");
  if (before.template !== after.template || before.templateChosen !== after.templateChosen)
    out.push("template");
  if (before.rows !== after.rows || before.cols !== after.cols) out.push("size");
  if (before.cellCapacity !== after.cellCapacity) out.push("cellCapacity");
  const a = before.appearance;
  const b = after.appearance;
  if (
    a.material !== b.material ||
    a.color !== b.color ||
    a.lighting !== b.lighting ||
    a.door !== b.door
  )
    out.push("look");
  if (JSON.stringify(before.zones) !== JSON.stringify(after.zones)) out.push("zones");
  return out;
}

/**
 * A draft carried over onto a newer version of its place (the person chose "keep my changes" after someone else saved
 * it): every part the person changed is theirs, every other part is the latest version's. Nothing is guessed beyond
 * that, and nothing is saved by this: the result is a draft, checked by assess() against the place's bottles as they
 * are now, and saved (or not) by the person, against the latest revision.
 *   - a new template is a new structure: its size, bottles per spot and zones come with it (they belong together);
 *   - otherwise size, bottles per spot and zones each follow whoever changed them; the look and the name likewise.
 * `theirs` and `mine` say what each side changed; `both` the parts both changed, where the person's version is kept.
 */
export function rebaseDraft(
  mine: BuilderDraft,
  base: BuilderDraft,
  latest: BuilderDraft,
): { draft: BuilderDraft; mine: ChangeKind[]; theirs: ChangeKind[]; both: ChangeKind[] } {
  const mineChanged = changesBetween(base, mine);
  const theirs = changesBetween(base, latest);
  const has = (k: ChangeKind) => mineChanged.includes(k);
  const draft: BuilderDraft = { ...latest, zones: latest.zones.map((z) => ({ ...z })) };
  if (has("name")) draft.name = mine.name;
  if (has("look")) draft.appearance = mine.appearance;
  if (has("template")) {
    Object.assign(draft, {
      template: mine.template,
      templateChosen: mine.templateChosen,
      rows: mine.rows,
      cols: mine.cols,
      cellCapacity: mine.cellCapacity,
      zones: mine.zones.map((z) => ({ ...z })),
    });
  } else {
    if (has("size")) Object.assign(draft, { rows: mine.rows, cols: mine.cols });
    if (has("cellCapacity")) draft.cellCapacity = mine.cellCapacity;
    if (has("zones")) draft.zones = mine.zones.map((z) => ({ ...z }));
  }
  return { draft, mine: mineChanged, theirs, both: mineChanged.filter((k) => theirs.includes(k)) };
}

/** Changes that deserve a confirmation before they are saved over an existing place. */
export const SIGNIFICANT: readonly ChangeKind[] = ["template", "size", "cellCapacity"];
