import { describe, expect, it } from "vitest";
import { STORAGE_KINDS } from "./cellar";
import {
  DEFAULT_TEMPLATE_FOR_KIND,
  LAYOUT_FAMILIES,
  SLOT_SEMANTICS,
  STORAGE_CATALOG_VERSION,
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
  isStorageTemplateId,
  templatesForKind,
} from "./storage-templates";

const all = STORAGE_TEMPLATE_IDS.map((id) => STORAGE_TEMPLATES[id]);

describe("the storage template catalogue", () => {
  it("is version 1 and has the fourteen first templates, each once", () => {
    expect(STORAGE_CATALOG_VERSION).toBe(1);
    expect(STORAGE_TEMPLATE_IDS).toHaveLength(14);
    expect(new Set(STORAGE_TEMPLATE_IDS).size).toBe(14);
    expect(Object.keys(STORAGE_TEMPLATES).sort()).toEqual([...STORAGE_TEMPLATE_IDS].sort());
  });

  // An id is stored with a place: it never changes, and neither does what its spots mean. Adding a row here is
  // fine; changing one is a migration of people's cellars.
  it("keeps every released id, kind, family and slot semantics", () => {
    expect(all.map((t) => [t.id, t.kind, t.family, t.semantics])).toEqual([
      ["rack_classic", "rack", "grid", "depth"],
      ["rack_double_depth", "rack", "grid", "depth"],
      ["rack_metal", "rack", "grid", "depth"],
      ["shelving_open", "shelving", "grid", "depth"],
      ["cabinet_closed", "cabinet", "grid", "depth"],
      ["cube_modular", "shelving", "bins", "ordinal"],
      ["diamond_bins", "rack", "bins", "ordinal"],
      ["crate_storage", "other", "bins", "ordinal"],
      ["wall_pegs", "wall", "wall", "single"],
      ["wall_rails", "wall", "wall", "depth"],
      ["cooler_single", "fridge", "grid", "depth"],
      ["cooler_dual", "fridge", "grid", "depth"],
      ["cooler_undercounter", "fridge", "grid", "depth"],
      ["rack_generic", "other", "grid", "depth"],
    ]);
  });

  it("only the coolers have temperature zones", () => {
    expect(all.filter((t) => t.zones).map((t) => [t.id, t.zones!.max])).toEqual([
      ["cooler_single", 1],
      ["cooler_dual", 2],
      ["cooler_undercounter", 2],
    ]);
  });

  for (const t of all) {
    describe(t.id, () => {
      it("has an id the database can check, under its own key", () => {
        expect(t.id).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
        expect(STORAGE_TEMPLATES[t.id]).toBe(t);
      });

      it("maps to an existing storage kind, a layout family and a slot semantics", () => {
        expect(STORAGE_KINDS).toContain(t.kind);
        expect(LAYOUT_FAMILIES).toContain(t.family);
        expect(SLOT_SEMANTICS).toContain(t.semantics);
      });

      it("has limits that hold together and stay under the hard ceilings", () => {
        for (const [field, ceiling] of [
          ["rows", STORAGE_LIMITS.rows],
          ["cols", STORAGE_LIMITS.cols],
          ["cellCapacity", STORAGE_LIMITS.cellCapacity],
        ] as const) {
          const l = t[field];
          expect(Number.isInteger(l.min) && Number.isInteger(l.max)).toBe(true);
          expect(Number.isInteger(l.default)).toBe(true);
          expect(l.min).toBeGreaterThanOrEqual(1);
          expect(l.default).toBeGreaterThanOrEqual(l.min);
          expect(l.default).toBeLessThanOrEqual(l.max);
          expect(l.max).toBeLessThanOrEqual(ceiling);
        }
        expect(t.maxCapacity).toBeLessThanOrEqual(STORAGE_LIMITS.capacity);
        // its out-of-the-box size fits, and so does its smallest
        expect(t.rows.default * t.cols.default * t.cellCapacity.default).toBeLessThanOrEqual(
          t.maxCapacity,
        );
        expect(t.rows.min * t.cols.min * t.cellCapacity.min).toBeLessThanOrEqual(t.maxCapacity);
      });

      it("has slot semantics that fit its family and its cell capacity", () => {
        if (t.semantics === "single")
          expect(t.cellCapacity).toEqual({ min: 1, max: 1, default: 1 });
        if (t.family === "grid") expect(t.semantics).toBe("depth");
        // a compartment is a pile: its index is a counter, never a place
        if (t.family === "bins") expect(t.semantics).toBe("ordinal");
        // on a wall there is one position, unless the template says in so many words how deep it is
        if (t.family === "wall" && t.semantics !== "single") {
          expect(t.id).toBe("wall_rails");
          expect(t.semantics).toBe("depth");
        }
      });

      it("has zones that make a sensible default split, or none", () => {
        if (!t.zones) return;
        expect(t.zones.max).toBeGreaterThanOrEqual(1);
        expect(t.zones.max).toBeLessThanOrEqual(STORAGE_LIMITS.zones);
        expect(t.zones.defaults.length).toBeGreaterThanOrEqual(1);
        expect(t.zones.defaults.length).toBeLessThanOrEqual(t.zones.max);
        expect(t.zones.defaults.reduce((s, z) => s + z.share, 0)).toBeCloseTo(1, 10);
        for (const z of t.zones.defaults) {
          expect(z.share).toBeGreaterThan(0);
          expect(ZONE_PURPOSES).toContain(z.purpose);
          expect(z.targetTempC).toBeGreaterThanOrEqual(ZONE_TEMP_C.min);
          expect(z.targetTempC).toBeLessThanOrEqual(ZONE_TEMP_C.max);
          expect((z.targetTempC / ZONE_TEMP_C.step) % 1).toBe(0);
        }
      });

      it("offers looks from the shared vocabulary, its default among them", () => {
        const a = t.appearance;
        expect(a.materials.length).toBeGreaterThan(0);
        expect(a.lighting.length).toBeGreaterThan(0);
        expect(a.doors.length).toBeGreaterThan(0);
        for (const m of a.materials) expect(STORAGE_MATERIALS).toContain(m);
        for (const l of a.lighting) expect(STORAGE_LIGHTING).toContain(l);
        for (const d of a.doors) expect(STORAGE_DOORS).toContain(d);
        expect(a.materials).toContain(a.default.material);
        expect(STORAGE_PALETTES[a.default.material]).toContain(a.default.color);
        expect(a.lighting).toContain(a.default.lighting);
        expect(a.doors).toContain(a.default.door);
      });
    });
  }
});

describe("the look vocabulary", () => {
  it("every colour comes in at least one material, and every palette colour is a known colour", () => {
    const used = new Set(Object.values(STORAGE_PALETTES).flat());
    expect([...used].sort()).toEqual([...STORAGE_COLORS].sort());
    expect(Object.keys(STORAGE_PALETTES).sort()).toEqual([...STORAGE_MATERIALS].sort());
  });
});

describe("looking a template up", () => {
  it("knows its own ids and nothing else", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      expect(isStorageTemplateId(id)).toBe(true);
      expect(getStorageTemplate(id)?.id).toBe(id);
    }
    for (const junk of [
      "",
      "rack",
      "RACK_CLASSIC",
      "rack_classic ",
      "cooler_triple",
      7,
      null,
      {},
    ]) {
      expect(isStorageTemplateId(junk)).toBe(false);
      expect(getStorageTemplate(junk)).toBeNull();
    }
  });

  it("is not fooled by names every object has", () => {
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty"])
      expect(getStorageTemplate(name)).toBeNull();
  });

  it("cannot be changed at run time", () => {
    const t = STORAGE_TEMPLATES.rack_classic;
    expect(Object.isFrozen(STORAGE_TEMPLATES)).toBe(true);
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t.rows)).toBe(true);
    expect(Object.isFrozen(t.appearance.default)).toBe(true);
    expect(() => {
      (t.rows as { max: number }).max = 99;
    }).toThrow(TypeError);
    expect(STORAGE_TEMPLATES.rack_classic.rows.max).toBe(30);
  });

  it("lists the templates of a kind in catalogue order", () => {
    expect(templatesForKind("fridge").map((t) => t.id)).toEqual([
      "cooler_single",
      "cooler_dual",
      "cooler_undercounter",
    ]);
    expect(templatesForKind("wall").map((t) => t.id)).toEqual(["wall_pegs", "wall_rails"]);
    for (const kind of STORAGE_KINDS) expect(templatesForKind(kind).length).toBeGreaterThan(0);
    expect(STORAGE_KINDS.flatMap((k) => templatesForKind(k))).toHaveLength(14);
  });
});

describe("the template a place from before templates is read as", () => {
  // The sizes the "new place" sheet has always started from (new-place-sheet.tsx, DEFAULT_GRID).
  const STARTING_GRID = {
    fridge: [5, 4],
    rack: [5, 8],
    cabinet: [4, 6],
    shelving: [4, 6],
    wall: [6, 6],
    other: [4, 6],
  } as const;

  for (const kind of STORAGE_KINDS) {
    it(`${kind}: its own kind, any size the database allows, one bottle per cell`, () => {
      const t = STORAGE_TEMPLATES[DEFAULT_TEMPLATE_FOR_KIND[kind]];
      expect(t.kind).toBe(kind);
      expect([t.rows.min, t.rows.max]).toEqual([1, 30]);
      expect([t.cols.min, t.cols.max]).toEqual([1, 30]);
      expect(t.cellCapacity.min).toBe(1);
      expect(t.cellCapacity.default).toBe(1);
      expect(t.maxCapacity).toBeGreaterThanOrEqual(900);
      expect([t.rows.default, t.cols.default]).toEqual(STARTING_GRID[kind]);
    });
  }
});
