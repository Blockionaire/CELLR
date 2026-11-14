import { describe, expect, it } from "vitest";
import {
  STORAGE_APPEARANCE_VERSION,
  StorageAppearanceSchema,
  StorageConfigSchema,
  StorageStructureSchema,
  StorageZoneSchema,
  checkZones,
  defaultAppearance,
  defaultStorageConfig,
  defaultStructure,
  defaultZones,
  layoutOfStructure,
  readAppearance,
  structureCapacity,
  unsupportedStyle,
  zoneOfRow,
  type StorageStructure,
} from "./storage-config";
import { enumerateSlots } from "./storage-layout";
import {
  STORAGE_DOORS,
  STORAGE_LIGHTING,
  STORAGE_MATERIALS,
  STORAGE_PALETTES,
  STORAGE_TEMPLATE_IDS,
  STORAGE_TEMPLATES,
  type StorageTemplateId,
} from "./storage-templates";

const ok = (input: unknown) => StorageStructureSchema.safeParse(input).success;
const structure = (
  template: StorageTemplateId,
  over: Partial<StorageStructure> = {},
): StorageStructure => ({ ...defaultStructure(template), zones: [], ...over });

describe("every template out of the box", () => {
  for (const id of STORAGE_TEMPLATE_IDS) {
    it(`${id}: its default structure, look and whole configuration are valid to write`, () => {
      const s = defaultStructure(id);
      expect(StorageStructureSchema.parse(s)).toEqual(s);
      expect(StorageAppearanceSchema.parse(defaultAppearance(id))).toEqual(defaultAppearance(id));
      expect(StorageConfigSchema.parse(defaultStorageConfig(id))).toEqual(defaultStorageConfig(id));
      expect(unsupportedStyle(STORAGE_TEMPLATES[id], defaultAppearance(id))).toEqual([]);
    });

    it(`${id}: its layout has its family, its semantics and as many spots as its capacity`, () => {
      const s = defaultStructure(id);
      const t = STORAGE_TEMPLATES[id];
      const layout = layoutOfStructure(s);
      expect(layout.family).toBe(t.family);
      expect(layout.semantics).toBe(t.semantics);
      expect(layout.capacity).toBe(structureCapacity(s));
      expect(enumerateSlots(layout)).toHaveLength(structureCapacity(s));
      expect(layout.capacity).toBeLessThanOrEqual(t.maxCapacity);
      expect(layout.cells).toHaveLength(s.rows * s.cols);
    });

    it(`${id}: has default zones exactly when the template has zones`, () => {
      const t = STORAGE_TEMPLATES[id];
      const zones = defaultStructure(id).zones;
      expect(zones.length > 0).toBe(t.zones !== null);
      if (t.zones) expect(zones).toHaveLength(Math.min(t.zones.defaults.length, t.rows.default));
    });
  }

  it("the dual-zone cooler starts as serving above storage, half and half", () => {
    expect(defaultStructure("cooler_dual")).toEqual({
      template: "cooler_dual",
      rows: 8,
      cols: 5,
      cellCapacity: 1,
      zones: [
        { fromRow: 1, toRow: 4, purpose: "serving", targetTempC: 8 },
        { fromRow: 5, toRow: 8, purpose: "storage", targetTempC: 12 },
      ],
    });
  });
});

describe("the sizes a template supports", () => {
  for (const id of STORAGE_TEMPLATE_IDS) {
    const t = STORAGE_TEMPLATES[id];
    const fits = (s: StorageStructure) => structureCapacity(s) <= t.maxCapacity;

    it(`${id}: takes its smallest and largest of each dimension, and nothing past them`, () => {
      for (const field of ["rows", "cols", "cellCapacity"] as const) {
        // the other two at their smallest, so only this dimension is being tested
        const base = structure(id, {
          rows: t.rows.min,
          cols: t.cols.min,
          cellCapacity: t.cellCapacity.min,
        });
        const { min, max } = t[field];
        expect(ok({ ...base, [field]: min })).toBe(true);
        expect(ok({ ...base, [field]: max })).toBe(fits({ ...base, [field]: max }));
        expect(ok({ ...base, [field]: min - 1 })).toBe(false);
        expect(ok({ ...base, [field]: max + 1 })).toBe(false);
      }
    });

    it(`${id}: every size is accepted exactly when it is within the limits and the capacity`, () => {
      let accepted = 0;
      for (let rows = 1; rows <= 30; rows += rows < 4 ? 1 : 13)
        for (let cols = 1; cols <= 30; cols += cols < 4 ? 1 : 13)
          for (let cap = 1; cap <= 16; cap += cap < 4 ? 1 : 6) {
            const s = structure(id, { rows, cols, cellCapacity: cap });
            const within =
              rows >= t.rows.min &&
              rows <= t.rows.max &&
              cols >= t.cols.min &&
              cols <= t.cols.max &&
              cap >= t.cellCapacity.min &&
              cap <= t.cellCapacity.max;
            expect(ok(s)).toBe(within && fits(s));
            if (within && fits(s)) accepted++;
          }
      expect(accepted).toBeGreaterThan(0);
    });
  }

  it("bounds what one place holds, whatever its shape", () => {
    // two deep: 30 x 20 x 2 is the 1200 a place may hold; 30 x 30 x 2 would be 1800
    expect(ok(structure("rack_double_depth", { rows: 30, cols: 20, cellCapacity: 2 }))).toBe(true);
    expect(ok(structure("rack_double_depth", { rows: 30, cols: 21, cellCapacity: 2 }))).toBe(false);
    expect(ok(structure("rack_double_depth", { rows: 30, cols: 30, cellCapacity: 2 }))).toBe(false);
    // the largest place there is today stays valid
    expect(ok(structure("rack_classic", { rows: 30, cols: 30, cellCapacity: 1 }))).toBe(true);
    expect(ok(structure("cube_modular", { rows: 10, cols: 10, cellCapacity: 12 }))).toBe(true);
    expect(ok(structure("cube_modular", { rows: 10, cols: 10, cellCapacity: 13 }))).toBe(false);
  });

  it("holds each template to what its cells are", () => {
    // a peg holds one bottle; a rail may be up to three deep; a classic rack is one deep, a double one is not
    expect(ok(structure("wall_pegs", { cellCapacity: 2 }))).toBe(false);
    expect(ok(structure("wall_rails", { cellCapacity: 3 }))).toBe(true);
    expect(ok(structure("wall_rails", { cellCapacity: 4 }))).toBe(false);
    expect(ok(structure("rack_classic", { cellCapacity: 2 }))).toBe(false);
    expect(ok(structure("rack_double_depth", { cellCapacity: 1 }))).toBe(false);
    expect(ok(structure("cooler_dual", { rows: 1 }))).toBe(false);
  });
});

describe("a structure that is not one is refused", () => {
  const good = structure("rack_classic");

  it("accepts the good one, and fills in no zones when none are sent", () => {
    expect(ok(good)).toBe(true);
    const withoutZones = { template: good.template, rows: 5, cols: 8, cellCapacity: 1 };
    expect(StorageStructureSchema.parse(withoutZones).zones).toEqual([]);
  });

  it("refuses an unknown template, anything extra, and anything that is not a whole number", () => {
    expect(ok({ ...good, template: "rack_fancy" })).toBe(false);
    expect(ok({ ...good, template: "__proto__" })).toBe(false);
    expect(ok({ ...good, template: undefined })).toBe(false);
    expect(ok({ ...good, mesh: "https://example.com/rack.glb" })).toBe(false);
    expect(ok({ ...good, script: "alert(1)" })).toBe(false);
    for (const bad of [0, -1, 1.5, 31, "5", null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(ok({ ...good, rows: bad })).toBe(false);
      expect(ok({ ...good, cols: bad })).toBe(false);
    }
    for (const bad of [0, 17, 1.5, "1", null])
      expect(ok({ ...good, cellCapacity: bad })).toBe(false);
    for (const bad of [null, undefined, 7, "rack_classic", []]) expect(ok(bad)).toBe(false);
  });

  it("says which field is wrong", () => {
    const issues = (input: unknown) =>
      StorageStructureSchema.safeParse(input).error?.issues.map((i) => i.path.join(".")) ?? [];
    expect(issues(structure("cooler_undercounter", { rows: 9 }))).toEqual(["rows"]);
    expect(issues(structure("wall_pegs", { cellCapacity: 2 }))).toEqual(["cellCapacity"]);
    expect(
      issues(
        structure("rack_classic", {
          zones: [{ fromRow: 1, toRow: 5, purpose: "storage", targetTempC: 12 }],
        }),
      ),
    ).toEqual(["zones"]);
  });
});

describe("temperature zones", () => {
  const cooler = (rows: number, zones: StorageStructure["zones"]) =>
    structure("cooler_dual", { rows, zones });
  const zone = (fromRow: number, toRow: number, targetTempC: number | null = 12) =>
    ({ fromRow, toRow, purpose: "storage", targetTempC }) as const;

  it("are a split of the shelves: every shelf in one zone, top to bottom", () => {
    expect(ok(cooler(8, []))).toBe(true);
    expect(ok(cooler(8, [zone(1, 8)]))).toBe(true);
    expect(ok(cooler(8, [zone(1, 3), zone(4, 8)]))).toBe(true);
    expect(ok(cooler(8, [zone(1, 1), zone(2, 8)]))).toBe(true);
    // a gap, an overlap, a late start, an early end, past the bottom, the wrong order, upside down
    expect(ok(cooler(8, [zone(1, 3), zone(5, 8)]))).toBe(false);
    expect(ok(cooler(8, [zone(1, 4), zone(4, 8)]))).toBe(false);
    expect(ok(cooler(8, [zone(2, 8)]))).toBe(false);
    expect(ok(cooler(8, [zone(1, 7)]))).toBe(false);
    expect(ok(cooler(8, [zone(1, 4), zone(5, 9)]))).toBe(false);
    expect(ok(cooler(8, [zone(5, 8), zone(1, 4)]))).toBe(false);
    expect(ok(cooler(8, [zone(4, 1), zone(5, 8)]))).toBe(false);
  });

  it("are as many as the template has, and none where it has none", () => {
    expect(ok(cooler(9, [zone(1, 3), zone(4, 6), zone(7, 9)]))).toBe(false);
    expect(ok(structure("cooler_single", { zones: [zone(1, 5)] }))).toBe(true);
    expect(ok(structure("cooler_single", { zones: [zone(1, 2), zone(3, 5)] }))).toBe(false);
    expect(ok(structure("rack_classic", { zones: [zone(1, 5)] }))).toBe(false);
    expect(ok(structure("cabinet_closed", { zones: [zone(1, 4)] }))).toBe(false);
    expect(checkZones(STORAGE_TEMPLATES.rack_classic, 5, [zone(1, 5)])).toBe("not_supported");
    expect(checkZones(STORAGE_TEMPLATES.cooler_single, 5, [zone(1, 2), zone(3, 5)])).toBe(
      "too_many",
    );
    expect(checkZones(STORAGE_TEMPLATES.cooler_dual, 5, [zone(1, 2), zone(4, 5)])).toBe(
      "not_a_split",
    );
    expect(checkZones(STORAGE_TEMPLATES.cooler_dual, 5, [zone(1, 2), zone(3, 5)])).toBeNull();
  });

  it("carry a temperature that is set, in half degrees within reason, or not said at all", () => {
    for (const t of [3, 8, 12.5, 22, null]) expect(ok(cooler(8, [zone(1, 8, t)]))).toBe(true);
    for (const t of [2.5, 22.5, 12.25, -4, 100, Number.NaN])
      expect(ok(cooler(8, [zone(1, 8, t)]))).toBe(false);
    expect(StorageZoneSchema.safeParse({ ...zone(1, 8), targetTempC: "12" }).success).toBe(false);
    expect(StorageZoneSchema.safeParse({ ...zone(1, 8), purpose: "freezing" }).success).toBe(false);
    // a zone has no place for a measured value: it would be refused, not stored
    expect(StorageZoneSchema.safeParse({ ...zone(1, 8), currentTempC: 13 }).success).toBe(false);
    expect(StorageZoneSchema.safeParse({ ...zone(1, 8), sensor: "abc" }).success).toBe(false);
  });

  it("default to a valid split for every number of shelves", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[id];
      for (let rows = 1; rows <= 30; rows++) {
        const zones = defaultZones(t, rows);
        if (!t.zones) {
          expect(zones).toEqual([]);
          continue;
        }
        expect(zones).toHaveLength(Math.min(t.zones.defaults.length, rows));
        expect(checkZones(t, rows, zones)).toBeNull();
        for (const z of zones) expect(StorageZoneSchema.safeParse(z).success).toBe(true);
        for (let row = 1; row <= rows; row++) expect(zoneOfRow(zones, row)).not.toBeNull();
      }
      expect(defaultZones(t, 0)).toEqual([]);
      expect(defaultZones(t, 2.5)).toEqual([]);
    }
  });

  it("tell which zone a shelf is in", () => {
    const zones = [zone(1, 3), zone(4, 8)];
    expect(zoneOfRow(zones, 1)).toBe(zones[0]);
    expect(zoneOfRow(zones, 3)).toBe(zones[0]);
    expect(zoneOfRow(zones, 4)).toBe(zones[1]);
    expect(zoneOfRow(zones, 9)).toBeNull();
    expect(zoneOfRow([], 1)).toBeNull();
  });
});

describe("appearance", () => {
  const look = defaultAppearance("cabinet_closed");

  it("is written in this version, from named choices only", () => {
    expect(look).toEqual({
      v: 1,
      material: "wood",
      color: "mahogany",
      lighting: "none",
      door: "solid",
    });
    expect(STORAGE_APPEARANCE_VERSION).toBe(1);
    const parse = (input: unknown) => StorageAppearanceSchema.safeParse(input).success;
    expect(parse(look)).toBe(true);
    expect(parse({ ...look, v: 2 })).toBe(false);
    expect(parse({ ...look, v: "1" })).toBe(false);
    expect(parse({ material: "wood", color: "oak", lighting: "none", door: "none" })).toBe(false);
    expect(parse({ ...look, material: "marble" })).toBe(false);
    // no colour typed in, no texture, no mesh, nothing extra
    expect(parse({ ...look, color: "#ff0000" })).toBe(false);
    expect(parse({ ...look, color: "url(javascript:alert(1))" })).toBe(false);
    expect(parse({ ...look, texture: "https://example.com/wood.jpg" })).toBe(false);
    expect(parse({ ...look, mesh: { vertices: [0, 0, 0] } })).toBe(false);
    expect(parse({ ...look, lighting: "disco" })).toBe(false);
    expect(parse({ ...look, door: "curtain" })).toBe(false);
  });

  it("takes every colour of a material's palette and no other", () => {
    for (const material of STORAGE_MATERIALS)
      for (const color of Object.values(STORAGE_PALETTES).flat())
        expect(StorageAppearanceSchema.safeParse({ ...look, material, color }).success).toBe(
          STORAGE_PALETTES[material].includes(color),
        );
  });

  it("must be a look the template offers, to be written with it", () => {
    const config = defaultStorageConfig("rack_classic");
    const withLook = (over: object) =>
      StorageConfigSchema.safeParse({ ...config, appearance: { ...config.appearance, ...over } });
    expect(withLook({}).success).toBe(true);
    expect(withLook({ color: "oak", lighting: "warm" }).success).toBe(true);
    // a wooden rack is not metal, has no door and no cool light
    const metal = withLook({ material: "metal", color: "black" });
    expect(metal.success).toBe(false);
    expect(metal.error?.issues.map((i) => i.path.join("."))).toEqual(["appearance.material"]);
    expect(withLook({ door: "glass" }).success).toBe(false);
    expect(withLook({ lighting: "cool" }).success).toBe(false);
    expect(StorageConfigSchema.safeParse({ ...config, extra: true }).success).toBe(false);
  });

  it("every look a template offers is one it accepts, and it accepts no other", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[id];
      const config = defaultStorageConfig(id);
      for (const material of STORAGE_MATERIALS)
        for (const lighting of STORAGE_LIGHTING)
          for (const door of STORAGE_DOORS) {
            const appearance = {
              v: 1,
              material,
              color: STORAGE_PALETTES[material][0],
              lighting,
              door,
            };
            const offered =
              t.appearance.materials.includes(material) &&
              t.appearance.lighting.includes(lighting) &&
              t.appearance.doors.includes(door);
            expect(StorageConfigSchema.safeParse({ ...config, appearance }).success).toBe(offered);
          }
    }
  });
});

describe("reading a stored appearance", () => {
  const fallback = defaultAppearance("cooler_single");

  it("uses a valid one as it is", () => {
    const stored = { v: 1, material: "lacquer", color: "white", lighting: "cool", door: "solid" };
    expect(readAppearance("cooler_single", stored)).toEqual({
      appearance: stored,
      source: "stored",
    });
  });

  it("gives the template's default, whole, for another version or anything malformed", () => {
    const good = { v: 1, material: "lacquer", color: "white", lighting: "cool", door: "solid" };
    for (const stored of [
      undefined,
      null,
      {},
      "wood",
      42,
      [],
      { ...good, v: 2 },
      { ...good, v: 0 },
      { ...good, v: "1" },
      { ...good, material: "marble" },
      { ...good, color: "#ffffff" },
      { ...good, glow: 3 },
      { material: "lacquer" },
    ])
      expect(readAppearance("cooler_single", stored)).toEqual({
        appearance: fallback,
        source: "default",
      });
  });

  it("replaces only the choice the template does not offer", () => {
    // a cooler has no wooden shell: the material goes back to the default, and its colour with it
    expect(
      readAppearance("cooler_single", {
        v: 1,
        material: "wood",
        color: "oak",
        lighting: "cool",
        door: "solid",
      }),
    ).toEqual({
      appearance: { v: 1, material: "metal", color: "graphite", lighting: "cool", door: "solid" },
      source: "adjusted",
    });
    // a cooler always has a door
    expect(
      readAppearance("cooler_single", {
        v: 1,
        material: "lacquer",
        color: "sage",
        lighting: "none",
        door: "none",
      }),
    ).toEqual({
      appearance: { v: 1, material: "lacquer", color: "sage", lighting: "none", door: "glass" },
      source: "adjusted",
    });
  });

  it("always gives a look the template accepts, whatever was stored", () => {
    const junk: unknown[] = [null, 1, "x", { v: 1 }, { v: 9, material: "wood" }];
    for (const id of STORAGE_TEMPLATE_IDS) {
      for (const material of STORAGE_MATERIALS)
        for (const color of STORAGE_PALETTES[material])
          for (const lighting of STORAGE_LIGHTING)
            for (const door of STORAGE_DOORS) junk.push({ v: 1, material, color, lighting, door });
      for (const stored of junk) {
        const { appearance } = readAppearance(id, stored);
        expect(
          StorageConfigSchema.safeParse({ structure: defaultStructure(id), appearance }).success,
        ).toBe(true);
      }
      junk.length = 5;
    }
  });
});

describe("a configuration written out and read back", () => {
  it("is the same configuration, for every template", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const config = defaultStorageConfig(id);
      const text = JSON.stringify(config);
      expect(StorageConfigSchema.parse(JSON.parse(text))).toEqual(config);
      // and the same text again: nothing depends on the order things happen to be in
      expect(JSON.stringify(StorageConfigSchema.parse(JSON.parse(text)))).toBe(text);
    }
  });

  it("is only names and numbers: small, and nothing in it that is drawn or run", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const text = JSON.stringify(defaultStorageConfig(id));
      expect(text.length).toBeLessThan(512);
      expect(JSON.stringify(defaultAppearance(id)).length).toBeLessThan(128);
    }
  });
});
