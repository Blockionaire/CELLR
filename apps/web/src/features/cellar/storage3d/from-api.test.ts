import { describe, expect, it } from "vitest";
import {
  STORAGE_TEMPLATES,
  STORAGE_TEMPLATE_IDS,
  defaultAppearance,
  defaultStructure,
  type SmartPlacementView,
  type SmartStorageUnitView,
} from "@cellr/domain";
import { resolvedFromView, storedBottlesFrom } from "./from-api";
import { buildModel, placeBottles } from "./model";

const unit = (over: Partial<SmartStorageUnitView> = {}): SmartStorageUnitView => ({
  id: "p",
  label: "Rack",
  kind: "rack",
  templateId: null,
  layoutTemplateId: "rack_classic",
  family: "grid",
  rows: 4,
  cols: 6,
  cellCapacity: 1,
  slotSemantics: null,
  indexMeaning: "single",
  appearance: defaultAppearance("rack_classic"),
  zones: [],
  capacity: 24,
  occupied: 0,
  free: 24,
  legacy: true,
  arrangementKnown: true,
  fallbacks: [],
  ...over,
});

const placement = (row: number, col: number, index: number): SmartPlacementView => ({
  bottleId: `b-${row}-${col}-${index}`,
  locationId: "p",
  row,
  col,
  index,
  vintageId: "v",
  wineId: "w",
  producer: "P",
  wineName: "W",
  year: 2015,
  type: "red",
});

describe("from the API to the new view", () => {
  it("a place from before templates is a legacy place, drawn as it always was", () => {
    const resolved = resolvedFromView(unit());
    expect(resolved.legacy).toBe(true);
    expect(buildModel(resolved).renderer).toBe("legacy");
  });

  it("every template comes back as itself, with the server's own fallbacks", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[id];
      const s = defaultStructure(id);
      const resolved = resolvedFromView(
        unit({
          kind: t.kind,
          templateId: id,
          layoutTemplateId: id,
          family: t.family,
          rows: s.rows,
          cols: s.cols,
          cellCapacity: s.cellCapacity,
          slotSemantics: t.semantics,
          appearance: defaultAppearance(id),
          zones: s.zones,
          legacy: false,
        }),
      );
      expect(resolved.template.id, id).toBe(id);
      expect(resolved.arrangementKnown, id).toBe(true);
      expect(resolved.structure.zones, id).toEqual(s.zones);
    }
    const replaced = resolvedFromView(unit({ fallbacks: ["appearance", "zones"] }));
    expect(replaced.fallbacks).toEqual(["appearance", "zones"]);
  });

  it("an unknown arrangement stays unknown: the neutral picture, never a template's furniture", () => {
    const resolved = resolvedFromView(
      unit({
        templateId: "hex_rack_2031",
        slotSemantics: "depth",
        legacy: false,
        arrangementKnown: false,
      }),
    );
    expect(resolved.arrangementKnown).toBe(false);
    expect(buildModel(resolved).renderer).toBe("neutral");
  });

  it("bottles keep their whole spot: index 1 as index 1, index 2 as index 2", () => {
    const bottles = storedBottlesFrom([placement(1, 1, 1), placement(2, 3, 2)]);
    expect(bottles.map((b) => [b.row, b.col, b.index])).toEqual([
      [1, 1, 1],
      [2, 3, 2],
    ]);
    expect(bottles[0]!.shape).toBe("bordeaux");
  });

  it("no bottle disappears: a spot the view cannot draw is reported as stranded, not dropped", () => {
    // a one-deep rack and a bottle at index 2 (a database that was made two deep elsewhere)
    const model = buildModel(
      resolvedFromView(unit({ templateId: "rack_classic", slotSemantics: "depth", legacy: false })),
    );
    const { placed, stranded } = placeBottles(
      model,
      storedBottlesFrom([placement(1, 1, 1), placement(1, 2, 2)]),
    );
    expect(placed.map((b) => b.id)).toEqual(["b-1-1-1"]);
    expect(stranded.map((b) => b.id)).toEqual(["b-1-2-2"]);
  });

  it("two deep where the arrangement is known: the bottle behind is drawn behind", () => {
    const resolved = resolvedFromView(
      unit({
        templateId: "rack_double_depth",
        layoutTemplateId: "rack_double_depth",
        cellCapacity: 2,
        slotSemantics: "depth",
        indexMeaning: "depth",
        legacy: false,
      }),
    );
    const { placed, stranded } = placeBottles(
      buildModel(resolved),
      storedBottlesFrom([placement(1, 1, 1), placement(1, 1, 2)]),
    );
    expect(stranded).toEqual([]);
    const [front, back] = placed;
    expect(front!.address.index).toBe(1);
    expect(back!.address.index).toBe(2);
    expect(back!.pose.position[2]).toBeLessThan(front!.pose.position[2]);
  });
});
