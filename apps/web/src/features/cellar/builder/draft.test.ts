import { describe, expect, it } from "vitest";
import {
  STORAGE_PALETTES,
  STORAGE_TEMPLATES,
  STORAGE_TEMPLATE_IDS,
  StorageConfigSchema,
  checkZones,
  defaultAppearance,
  templateSavable,
  type SmartStorageUnitView,
} from "@cellr/domain";
import {
  assess,
  changesBetween,
  chooseTemplate,
  dimensionRange,
  draftFromTemplate,
  draftFromUnit,
  resolvedOfDraft,
  rezone,
  setColor,
  setDimension,
  setDoor,
  setLighting,
  setMaterial,
  setZoneCount,
  setZonePurpose,
  setZoneSplit,
  setZoneTemp,
  strandedBy,
  toConfig,
  type CurrentPlace,
} from "./draft";

const named = (id: (typeof STORAGE_TEMPLATE_IDS)[number]) => draftFromTemplate(id, "My place");

const unit = (over: Partial<SmartStorageUnitView> = {}): SmartStorageUnitView => ({
  id: "p",
  label: "Old rack",
  kind: "rack",
  templateId: null,
  layoutTemplateId: "rack_classic",
  family: "grid",
  rows: 5,
  cols: 8,
  cellCapacity: 1,
  slotSemantics: null,
  indexMeaning: "single",
  appearance: defaultAppearance("rack_classic"),
  zones: [],
  capacity: 40,
  occupied: 0,
  free: 40,
  legacy: true,
  arrangementKnown: true,
  fallbacks: [],
  revision: "r1",
  ...over,
});
const CURRENT: CurrentPlace = { rows: 5, cols: 8, cellCapacity: 1, semantics: null, capacity: 40 };

describe("every template, as it comes out of the box", () => {
  it("all fourteen give a draft the domain's own schema accepts (structure and look)", () => {
    expect(STORAGE_TEMPLATE_IDS).toHaveLength(14);
    for (const id of STORAGE_TEMPLATE_IDS) {
      const draft = named(id);
      expect(StorageConfigSchema.safeParse(toConfig(draft)).success, id).toBe(true);
      expect(draft.templateChosen).toBe(true);
      // the preview is the domain's reading of exactly this draft: the template's own arrangement
      const resolved = resolvedOfDraft(draft);
      expect(resolved.template.id).toBe(id);
      expect(resolved.arrangementKnown, id).toBe(true);
      expect(resolved.fallbacks, id).toEqual([]);
    }
  });

  it("a template that needs more than one bottle per cell is PREVIEW ONLY, and is never reduced to one", () => {
    const previewOnly = STORAGE_TEMPLATE_IDS.filter((id) => !templateSavable(id));
    expect(previewOnly.sort()).toEqual(["cube_modular", "diamond_bins", "rack_double_depth"]);
    for (const id of previewOnly) {
      const draft = named(id);
      expect(draft.cellCapacity).toBe(STORAGE_TEMPLATES[id].cellCapacity.default);
      expect(draft.cellCapacity).toBeGreaterThan(1);
      const a = assess(draft, null, []);
      expect(a.savable).toBe(false);
      expect(a.problems).toContainEqual({ kind: "preview_only", templateNeedsDepth: true });
      // and the lowest it can go is still more than one
      expect(dimensionRange(draft, "cellCapacity").min).toBeGreaterThan(1);
    }
  });

  it("the others can be saved as they come, except crates (six a compartment): preview until one is chosen", () => {
    for (const id of STORAGE_TEMPLATE_IDS.filter(templateSavable)) {
      const a = assess(named(id), null, []);
      if (id === "crate_storage") {
        expect(a.problems).toEqual([{ kind: "preview_only", templateNeedsDepth: false }]);
        const one = setDimension(named(id), "cellCapacity", 1).draft;
        expect(assess(one, null, []).savable, id).toBe(true);
      } else expect(a.savable, `${id}: ${JSON.stringify(a.problems)}`).toBe(true);
    }
  });

  it("capacity is rows × cells × bottles per cell", () => {
    const a = assess(named("cooler_dual"), null, []);
    expect(a.capacity).toBe(8 * 5 * 1);
    expect(a.free).toBe(40);
    expect(a.delta).toBe(0);
  });
});

describe("dimensions", () => {
  it("stay inside the template's limits and its largest capacity", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      let draft = named(id);
      for (const field of ["rows", "cols", "cellCapacity"] as const) {
        draft = setDimension(draft, field, 999).draft;
        draft = setDimension(draft, field, -5).draft;
        draft = setDimension(draft, field, 999).draft;
      }
      const t = STORAGE_TEMPLATES[id];
      expect(draft.rows * draft.cols * draft.cellCapacity, id).toBeLessThanOrEqual(t.maxCapacity);
      for (const field of ["rows", "cols", "cellCapacity"] as const) {
        expect(draft[field], `${id} ${field}`).toBeGreaterThanOrEqual(t[field].min);
        expect(draft[field], `${id} ${field}`).toBeLessThanOrEqual(t[field].max);
      }
    }
  });

  it("the largest a dimension can be follows from the others (a 30 × 30 classic rack is its 900)", () => {
    const big = setDimension(
      setDimension(named("rack_classic"), "rows", 30).draft,
      "cols",
      30,
    ).draft;
    expect(big.rows * big.cols).toBe(900);
    expect(dimensionRange(named("wall_rails"), "rows")).toEqual({ min: 1, max: 30 });
  });

  it("zones follow the shelves: the same zones, still a split, with the change said", () => {
    const cooler = named("cooler_dual");
    expect(cooler.zones.map((z) => [z.fromRow, z.toRow])).toEqual([
      [1, 4],
      [5, 8],
    ]);
    const smaller = setDimension(cooler, "rows", 3);
    expect(smaller.reconciled).toEqual(["zones"]);
    expect(checkZones(STORAGE_TEMPLATES.cooler_dual, 3, smaller.draft.zones)).toBeNull();
    expect(smaller.draft.zones.map((z) => z.purpose)).toEqual(["serving", "storage"]);
    for (let rows = 2; rows <= 20; rows++) {
      const z = setDimension(cooler, "rows", rows).draft.zones;
      expect(checkZones(STORAGE_TEMPLATES.cooler_dual, rows, z), String(rows)).toBeNull();
    }
  });

  it("rezone never leaves a gap, an overlap or an empty zone", () => {
    const t = STORAGE_TEMPLATES.cooler_dual;
    for (let oldRows = 2; oldRows <= 20; oldRows++)
      for (let split = 1; split < oldRows; split++)
        for (let rows = 1; rows <= 20; rows++) {
          const z = rezone(
            t,
            [
              { fromRow: 1, toRow: split, purpose: "serving", targetTempC: 8 },
              { fromRow: split + 1, toRow: oldRows, purpose: "storage", targetTempC: null },
            ],
            rows,
          );
          expect(checkZones(t, rows, z), `${oldRows}/${split}→${rows}`).toBeNull();
        }
  });
});

describe("the look", () => {
  it("a material keeps its colour when it comes in it, otherwise takes a colour of its own, and says so", () => {
    let d = named("rack_generic"); // wood, walnut; offers wood, metal and lacquer
    const metal = setMaterial(d, "metal");
    expect(metal.reconciled).toEqual(["color"]);
    expect(STORAGE_PALETTES.metal).toContain(metal.draft.appearance.color);
    d = setColor(metal.draft, "black");
    const lacquer = setMaterial(d, "lacquer"); // black comes in lacquer too
    expect(lacquer.reconciled).toEqual([]);
    expect(lacquer.draft.appearance.color).toBe("black");
  });

  it("a choice the template does not offer is not taken", () => {
    const rack = named("rack_classic");
    expect(setMaterial(rack, "metal").draft).toBe(rack);
    expect(setColor(rack, "white")).toBe(rack);
    expect(setDoor(rack, "glass")).toBe(rack);
    expect(setLighting(named("rack_metal"), "warm").appearance.lighting).toBe("none");
  });

  it("whatever is chosen through these, the schema accepts", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[id];
      for (const m of t.appearance.materials)
        for (const c of STORAGE_PALETTES[m])
          for (const l of t.appearance.lighting)
            for (const door of t.appearance.doors) {
              let d = setMaterial(named(id), m).draft;
              d = setDoor(setLighting(setColor(d, c), l), door);
              const parsed = StorageConfigSchema.safeParse(toConfig(d));
              expect(parsed.success, `${id} ${m} ${c} ${l} ${door}`).toBe(true);
            }
    }
  });
});

describe("zones", () => {
  it("one or two zones on a two-zone cooler, never more, always a split", () => {
    const t = STORAGE_TEMPLATES.cooler_undercounter;
    let d = named("cooler_undercounter");
    expect(d.zones).toHaveLength(1);
    d = setZoneCount(d, 2);
    expect(d.zones).toHaveLength(2);
    expect(checkZones(t, d.rows, d.zones)).toBeNull();
    expect(setZoneCount(d, 3).zones).toHaveLength(2);
    expect(setZoneCount(d, 0).zones).toEqual([]);
  });

  it("the split moves, every shelf stays in one zone", () => {
    const d = named("cooler_dual");
    for (const at of [-3, 0, 1, 4, 7, 8, 20]) {
      const z = setZoneSplit(d, at).zones;
      expect(checkZones(STORAGE_TEMPLATES.cooler_dual, d.rows, z), String(at)).toBeNull();
    }
    expect(setZoneSplit(d, 2).zones.map((z) => z.toRow)).toEqual([2, 8]);
  });

  it("a set temperature is a setting in half degrees, or not said at all", () => {
    let d = named("cooler_single");
    d = setZoneTemp(d, 0, 11.3);
    expect(d.zones[0]!.targetTempC).toBe(11.5);
    d = setZoneTemp(d, 0, null);
    expect(d.zones[0]!.targetTempC).toBeNull();
    d = setZonePurpose(d, 0, "serving");
    expect(StorageConfigSchema.safeParse(toConfig(d)).success).toBe(true);
  });

  it("a template without zones has none", () => {
    expect(named("rack_classic").zones).toEqual([]);
    expect(setZoneCount(named("rack_classic"), 2).zones).toEqual([]);
  });
});

describe("an existing place", () => {
  it("from before templates: its kind's template SUGGESTED, its own size, and no save until one is chosen", () => {
    const d = draftFromUnit(unit());
    expect(d).toMatchObject({ template: "rack_classic", rows: 5, cols: 8, templateChosen: false });
    expect(assess(d, CURRENT, []).problems).toContainEqual({ kind: "no_template" });
    const chosen = chooseTemplate(d, "rack_classic", "edit").draft;
    expect(chosen.templateChosen).toBe(true);
    expect(assess(chosen, CURRENT, []).savable).toBe(true);
  });

  it("a stored template this app does not know is never taken for a known one", () => {
    const d = draftFromUnit(
      unit({
        legacy: false,
        templateId: "hex_rack_2031",
        arrangementKnown: false,
        fallbacks: ["unknown_template"],
      }),
    );
    expect(d.templateChosen).toBe(false);
    expect(assess(d, CURRENT, []).savable).toBe(false);
  });

  it("a known template: the draft is what is stored, and saving it unchanged is fine", () => {
    const d = draftFromUnit(
      unit({
        legacy: false,
        templateId: "rack_metal",
        layoutTemplateId: "rack_metal",
        appearance: defaultAppearance("rack_metal"),
        rows: 6,
        cols: 6,
      }),
    );
    expect(d).toMatchObject({ template: "rack_metal", rows: 6, cols: 6, templateChosen: true });
    expect(changesBetween(d, d)).toEqual([]);
  });

  it("another template keeps the size and every bottle where it is; what does not fit is a blocker", () => {
    const bottles = [
      { row: 5, col: 8, index: 1, bottleId: "b1" },
      { row: 1, col: 1, index: 1, bottleId: "b2" },
    ];
    const d = chooseTemplate(draftFromUnit(unit()), "cooler_undercounter", "edit");
    // 5 × 8 fits the undercounter cooler (at most 8 × 8): the size is kept; its look is a cooler's, and said
    expect(d.reconciled).not.toContain("size");
    expect(d.reconciled).toEqual(expect.arrayContaining(["material", "color", "door"]));
    expect(d.draft.rows).toBe(5);
    expect(d.draft.cols).toBe(8);
    expect(strandedBy(d.draft, bottles)).toEqual([]);
    const smaller = setDimension(d.draft, "cols", 6).draft;
    expect(strandedBy(smaller, bottles).map((b) => b.bottleId)).toEqual(["b1"]);
    const a = assess(smaller, CURRENT, bottles);
    expect(a.savable).toBe(false);
    expect(a.problems).toContainEqual({ kind: "layout", problem: "in_use" });
  });

  it("a size the new template cannot take is brought inside its limits, and said", () => {
    const big = draftFromUnit(unit({ rows: 12, cols: 12, capacity: 144 }));
    const d = chooseTemplate(big, "cooler_undercounter", "edit");
    expect(d.reconciled).toContain("size");
    expect([d.draft.rows, d.draft.cols]).toEqual([8, 8]);
    // a bottle on shelf 12 is not moved: it blocks the save
    const a = assess(d.draft, { ...CURRENT, rows: 12, cols: 12, capacity: 144 }, [
      { row: 12, col: 1, index: 1 },
    ]);
    expect(a.problems).toContainEqual({ kind: "layout", problem: "in_use" });
  });

  it("a look change alone changes no spot and is saved as a look change", () => {
    const before = chooseTemplate(draftFromUnit(unit()), "rack_classic", "edit").draft;
    const after = setColor(before, "oak");
    expect(changesBetween(before, after)).toEqual(["look"]);
    expect(assess(after, CURRENT, [{ row: 5, col: 8, index: 1 }]).savable).toBe(true);
  });

  it("capacity difference against what is stored", () => {
    const d = setDimension(
      chooseTemplate(draftFromUnit(unit()), "rack_classic", "edit").draft,
      "rows",
      7,
    ).draft;
    expect(assess(d, CURRENT, []).delta).toBe(16);
  });

  it("names: the existing create's rule", () => {
    expect(assess(draftFromTemplate("rack_classic", ""), null, []).problems).toContainEqual({
      kind: "name",
    });
    expect(
      assess(draftFromTemplate("rack_classic", "x".repeat(41)), null, []).problems,
    ).toContainEqual({ kind: "name" });
    expect(assess(draftFromTemplate("rack_classic", "  Cave  "), null, []).savable).toBe(true);
  });
});

describe("the catalogue", () => {
  it("shows every template exactly once, in groups from its kind and family", async () => {
    const { groupedTemplates, cardFacts } = await import("./catalogue");
    const ids = groupedTemplates().flatMap((g) => g.ids);
    expect([...ids].sort()).toEqual([...STORAGE_TEMPLATE_IDS].sort());
    const groups = Object.fromEntries(groupedTemplates().map((g) => [g.group, g.ids]));
    expect(groups.coolers).toEqual(["cooler_single", "cooler_dual", "cooler_undercounter"]);
    expect(groups.bins).toEqual(["cube_modular", "diamond_bins", "crate_storage"]);
    expect(groups.wall).toEqual(["wall_pegs", "wall_rails"]);
    // card facts are the catalogue's
    expect(cardFacts("rack_classic")).toEqual({
      capacity: 40,
      holds: { kind: "single" },
      zones: 0,
      door: false,
      savable: true,
    });
    expect(cardFacts("rack_double_depth")).toMatchObject({
      holds: { kind: "deep", min: 2, max: 3 },
      savable: false,
    });
    expect(cardFacts("cooler_dual")).toMatchObject({ zones: 2, door: true, savable: true });
  });
});

describe("a remembered draft", () => {
  it("comes back as it was", async () => {
    const { parseDraft } = await import("./draft");
    const d = setZoneTemp(named("cooler_dual"), 0, 7.5);
    expect(parseDraft(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it("anything else is not taken: an unknown template, numbers out of range, a look of another shape", async () => {
    const { parseDraft } = await import("./draft");
    const good = JSON.parse(JSON.stringify(named("rack_classic"))) as Record<string, unknown>;
    for (const bad of [
      null,
      "x",
      { ...good, template: "hex_rack_2031" },
      { ...good, template: "__proto__" },
      { ...good, rows: 0 },
      { ...good, rows: 31 },
      { ...good, cols: 2.5 },
      { ...good, cellCapacity: 99 },
      { ...good, appearance: { v: 2 } },
      { ...good, zones: [{ fromRow: 1 }] },
      { ...good, templateChosen: "yes" },
      { ...good, name: 5 },
    ])
      expect(parseDraft(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe("revisions (review corrections)", () => {
  it("a later time is newer; the same or an earlier one is not (an old answer never undoes a save)", async () => {
    const { isNewerRevision } = await import("./draft");
    const t1 = "2026-11-19T10:00:00.100000+00:00";
    const t2 = "2026-11-19T10:00:00.200000+00:00";
    expect(isNewerRevision(t2, t1)).toBe(true);
    expect(isNewerRevision(t1, t2)).toBe(false);
    expect(isNewerRevision(t1, t1)).toBe(false);
    expect(isNewerRevision(t1, null)).toBe(true);
    // not times: different is taken as newer (cautious)
    expect(isNewerRevision("r2", "r1")).toBe(true);
  });

  it("an answer after a save is the save's only when it shows what was saved", async () => {
    const { savedAsDrafted } = await import("./draft");
    const draft = chooseTemplate(draftFromUnit(unit()), "rack_classic", "edit").draft;
    const view = unit({
      legacy: false,
      templateId: "rack_classic",
      appearance: draft.appearance,
      label: "Another name",
    });
    expect(savedAsDrafted(draft, view)).toBe(true);
    expect(savedAsDrafted(setColor(draft, "oak"), view)).toBe(false);
    expect(savedAsDrafted(draft, { ...view, rows: 6 })).toBe(false);
  });
});
