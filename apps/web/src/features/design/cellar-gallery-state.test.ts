import { describe, expect, it } from "vitest";
import { STORAGE_PALETTES, STORAGE_TEMPLATES, STORAGE_TEMPLATE_IDS } from "@cellr/domain";
import {
  UNKNOWN_CASES,
  normalize,
  placeOf,
  toQuery,
  type UnknownCase,
} from "./cellar-gallery-state";

describe("what the template gallery shows", () => {
  it("offers every template, at its default, read without a single fallback", () => {
    for (const template of STORAGE_TEMPLATE_IDS) {
      const state = normalize({ template });
      const resolved = placeOf(state);
      expect(resolved.template.id).toBe(template);
      expect(resolved.legacy).toBe(false);
      expect(resolved.arrangementKnown).toBe(true);
      expect(resolved.fallbacks, template).toEqual([]);
      expect(resolved.appearance).toMatchObject(STORAGE_TEMPLATES[template].appearance.default);
    }
  });

  it("keeps whatever is typed into the address inside what the template allows", () => {
    for (const template of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[template];
      for (const wild of [
        { rows: "9999", cols: "9999", cap: "9999" },
        { rows: "-3", cols: "0", cap: "x" },
        { rows: "2.7", cols: "1e9" },
      ]) {
        const s = normalize({
          template,
          ...wild,
          material: "plutonium",
          color: "<script>",
          door: "portcullis",
          lighting: "disco",
        });
        expect(s.rows).toBeGreaterThanOrEqual(t.rows.min);
        expect(s.rows).toBeLessThanOrEqual(t.rows.max);
        expect(s.cols).toBeGreaterThanOrEqual(t.cols.min);
        expect(s.cols).toBeLessThanOrEqual(t.cols.max);
        expect(s.cap).toBeGreaterThanOrEqual(t.cellCapacity.min);
        expect(s.cap).toBeLessThanOrEqual(t.cellCapacity.max);
        expect(t.appearance.materials).toContain(s.material);
        expect(STORAGE_PALETTES[s.material]).toContain(s.color);
        expect(t.appearance.doors).toContain(s.door);
        expect(t.appearance.lighting).toContain(s.lighting);
        const resolved = placeOf(s);
        expect(resolved.fallbacks, `${template} ${JSON.stringify(wild)}`).toEqual([]);
        expect(resolved.layout.capacity).toBeLessThanOrEqual(t.maxCapacity);
      }
    }
  });

  it("an unknown template in the address is the first template, not an error", () => {
    expect(normalize({ template: "../../etc/passwd" }).template).toBe(STORAGE_TEMPLATE_IDS[0]);
  });

  it("every look a template offers can be chosen", () => {
    for (const template of STORAGE_TEMPLATE_IDS) {
      const look = STORAGE_TEMPLATES[template].appearance;
      for (const material of look.materials)
        for (const color of STORAGE_PALETTES[material])
          for (const door of look.doors)
            for (const lighting of look.lighting) {
              const s = normalize({ template, material, color, door, lighting });
              expect(placeOf(s).appearance).toMatchObject({ material, color, door, lighting });
            }
    }
  });

  it("a link to a picture is that picture", () => {
    const s = normalize({
      template: "cooler_dual",
      rows: "8",
      cols: "4",
      door: "solid",
      lighting: "cool",
      fill: "full",
      quality: "low",
    });
    const back = normalize(Object.fromEntries(new URLSearchParams(toQuery(s))));
    expect(back).toEqual(s);
    // and the default picture of a template is a short link
    expect(toQuery(normalize({ template: "rack_metal" }))).toBe(
      "sample=template&template=rack_metal",
    );
  });

  it("has a place from before templates, and places whose arrangement is not known", () => {
    const legacy = placeOf(normalize({ sample: "legacy", rows: "6", cols: "8" }));
    expect(legacy.legacy).toBe(true);
    expect(legacy.layout).toMatchObject({ rows: 6, cols: 8, capacity: 48 });
    for (const unknown of Object.keys(UNKNOWN_CASES) as UnknownCase[]) {
      const resolved = placeOf(normalize({ sample: "unknown", unknown }));
      expect(resolved.legacy).toBe(false);
      expect(resolved.arrangementKnown, unknown).toBe(false);
    }
  });

  it("can show the sizes the measurements are made at", () => {
    const sizes = [
      normalize({ template: "rack_classic", rows: "5", cols: "8", fill: "full" }),
      normalize({ template: "rack_classic", rows: "10", cols: "20", fill: "full" }),
      normalize({ template: "rack_classic", rows: "30", cols: "30", fill: "full" }),
      normalize({ template: "rack_double_depth", rows: "20", cols: "30", cap: "2", fill: "full" }),
    ].map((s) => placeOf(s).layout.capacity);
    expect(sizes).toEqual([40, 200, 900, 1200]);
  });
});
