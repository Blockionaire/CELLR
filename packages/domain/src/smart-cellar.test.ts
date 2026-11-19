import { describe, expect, it } from "vitest";
import { STORAGE_KINDS } from "./cellar";
import {
  DEPTH_PLACEMENT_ENABLED,
  cellCapacitySavable,
  templateSavable,
  indexMeaningOf,
  layoutChangeProblem,
  legacyEditProblem,
  type CurrentLayout,
} from "./smart-cellar";
import { resolveStorage } from "./storage-compat";
import { defaultStructure } from "./storage-config";
import { STORAGE_TEMPLATES, STORAGE_TEMPLATE_IDS } from "./storage-templates";

const ONE_DEEP: CurrentLayout = { rows: 5, cols: 8, cellCapacity: 1, semantics: null };

describe("what an index means, said truthfully", () => {
  it("a place from before templates is one bottle per position, whatever its kind", () => {
    for (const kind of STORAGE_KINDS) {
      const r = resolveStorage({ kind, rows: 4, cols: 6 });
      expect(r.legacy).toBe(true);
      expect(indexMeaningOf(r)).toBe("single");
    }
  });

  it("every template, stored as itself at its default size: single where one deep, its own meaning where deeper", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[id];
      const s = defaultStructure(id);
      const r = resolveStorage({
        kind: t.kind,
        rows: s.rows,
        cols: s.cols,
        template: id,
        cellCapacity: s.cellCapacity,
        semantics: t.semantics,
      });
      expect(r.arrangementKnown, id).toBe(true);
      expect(r.fallbacks, id).toEqual([]);
      expect(indexMeaningOf(r), id).toBe(s.cellCapacity > 1 ? t.semantics : "single");
    }
  });

  it("depth is said only where the arrangement is known", () => {
    const known = resolveStorage({
      kind: "rack",
      rows: 4,
      cols: 6,
      template: "rack_double_depth",
      cellCapacity: 2,
      semantics: "depth",
    });
    expect(indexMeaningOf(known)).toBe("depth");
    // a template this app does not know, two per cell: positions exist, depth is not claimed
    const unknown = resolveStorage({
      kind: "rack",
      rows: 4,
      cols: 6,
      template: "hex_rack_2031",
      cellCapacity: 2,
      semantics: "depth",
    });
    expect(unknown.arrangementKnown).toBe(false);
    expect(indexMeaningOf(unknown)).toBe("ordinal");
    // two deep on a place without a template
    const bare = resolveStorage({ kind: "rack", rows: 4, cols: 6, cellCapacity: 2 });
    expect(indexMeaningOf(bare)).toBe("ordinal");
    // a template of another kind than the place
    const mismatch = resolveStorage({
      kind: "wall",
      rows: 3,
      cols: 4,
      template: "rack_double_depth",
      cellCapacity: 2,
      semantics: "depth",
    });
    expect(mismatch.fallbacks).toContain("template_kind_mismatch");
    expect(indexMeaningOf(mismatch)).toBe("ordinal");
    // a stored meaning that is not the template's own
    const wrongMeaning = resolveStorage({
      kind: "rack",
      rows: 4,
      cols: 6,
      template: "rack_double_depth",
      cellCapacity: 2,
      semantics: "ordinal",
    });
    expect(wrongMeaning.fallbacks).toContain("semantics_mismatch");
    expect(indexMeaningOf(wrongMeaning)).toBe("ordinal");
  });

  it("an ordinal index is never called a depth", () => {
    for (const id of ["cube_modular", "diamond_bins", "crate_storage"] as const) {
      const t = STORAGE_TEMPLATES[id];
      const r = resolveStorage({
        kind: t.kind,
        rows: 2,
        cols: 3,
        template: id,
        cellCapacity: t.cellCapacity.max,
        semantics: "ordinal",
      });
      expect(indexMeaningOf(r)).toBe("ordinal");
    }
  });

  it("an unknown arrangement one deep is single: nothing is claimed about a position", () => {
    const r = resolveStorage({
      kind: "rack",
      rows: 3,
      cols: 4,
      template: "hex_rack_2031",
      cellCapacity: 1,
      semantics: "depth",
    });
    expect(r.arrangementKnown).toBe(false);
    expect(r.layout.semantics).toBe("depth"); // the stand-in template's own: NOT what the API says
    expect(indexMeaningOf(r)).toBe("single");
  });
});

describe("whether a layout may replace the current one", () => {
  const rack = (rows: number, cols: number, cellCapacity = 1) => ({
    template: "rack_classic" as const,
    rows,
    cols,
    cellCapacity,
    zones: [],
  });

  it("more than one bottle per cell is refused while depth is off", () => {
    expect(DEPTH_PLACEMENT_ENABLED).toBe(false);
    expect(
      layoutChangeProblem(
        ONE_DEEP,
        { template: "rack_double_depth", rows: 5, cols: 8, cellCapacity: 2, zones: [] },
        [],
      ),
    ).toBe("depth_not_enabled");
    // bins start at two per compartment: none of them can be saved yet
    expect(
      layoutChangeProblem(
        ONE_DEEP,
        { template: "diamond_bins", rows: 2, cols: 3, cellCapacity: 2, zones: [] },
        [],
      ),
    ).toBe("depth_not_enabled");
  });

  it("a valid one-deep layout over bottles that still fit is fine", () => {
    expect(
      layoutChangeProblem(ONE_DEEP, rack(5, 8), [
        { row: 5, col: 8, index: 1 },
        { row: 1, col: 1, index: 1 },
      ]),
    ).toBeNull();
    // growing is always fine
    expect(layoutChangeProblem(ONE_DEEP, rack(10, 10), [{ row: 5, col: 8, index: 1 }])).toBeNull();
  });

  it("fewer shelves, cells or positions than a bottle needs is refused", () => {
    expect(layoutChangeProblem(ONE_DEEP, rack(4, 8), [{ row: 5, col: 1, index: 1 }])).toBe(
      "in_use",
    );
    expect(layoutChangeProblem(ONE_DEEP, rack(5, 7), [{ row: 1, col: 8, index: 1 }])).toBe(
      "in_use",
    );
    // a bottle behind another (a place made two deep where depth was switched on) is never left without its spot
    const twoDeep: CurrentLayout = { rows: 5, cols: 8, cellCapacity: 2, semantics: "depth" };
    expect(layoutChangeProblem(twoDeep, rack(5, 8), [{ row: 1, col: 1, index: 2 }])).toBe("in_use");
  });

  it("the meaning of an index never changes under bottles whose index means something", () => {
    const deepRack: CurrentLayout = { rows: 2, cols: 3, cellCapacity: 2, semantics: "ordinal" };
    // ordinal → depth over a bottle: refused (it would become "behind the front one")
    expect(
      layoutChangeProblem(deepRack, { ...rack(2, 3), template: "rack_classic" }, [
        { row: 1, col: 1, index: 1 },
      ]),
    ).toBe("semantics_change");
    // empty: fine
    expect(layoutChangeProblem(deepRack, rack(2, 3), [])).toBeNull();
    // one deep: every index is 1 under any meaning, nothing to protect
    expect(
      layoutChangeProblem({ rows: 6, cols: 6, cellCapacity: 1, semantics: "single" }, rack(6, 6), [
        { row: 1, col: 1, index: 1 },
      ]),
    ).toBeNull();
  });
});

describe("edits through the old API on a place with a template", () => {
  const cooler = {
    template: "cooler_dual",
    kind: "fridge" as const,
    rows: 8,
    cols: 4,
    cellCapacity: 1,
  };

  it("a rename is always fine", () => {
    expect(legacyEditProblem(cooler, {})).toBeNull();
    expect(legacyEditProblem({ ...cooler, template: "hex_rack_2031" }, {})).toBeNull();
  });

  it("the kind follows from the template", () => {
    expect(legacyEditProblem(cooler, { kind: "rack" })).toBe("kind_mismatch");
    expect(legacyEditProblem(cooler, { kind: "fridge" })).toBeNull();
  });

  it("a size inside the template's limits is fine; outside is refused", () => {
    const t = STORAGE_TEMPLATES.cooler_dual;
    expect(legacyEditProblem(cooler, { rows: t.rows.max })).toBeNull();
    expect(legacyEditProblem(cooler, { rows: t.rows.max + 1 })).toBe("size_outside_template");
    expect(legacyEditProblem(cooler, { cols: t.cols.min - 1 })).toBe("size_outside_template");
    // within each limit but past what the template may hold in all
    expect(legacyEditProblem(cooler, { rows: t.rows.max, cols: t.cols.max })).toBe(
      t.rows.max * t.cols.max > t.maxCapacity ? "size_outside_template" : null,
    );
  });

  it("a template this server does not know keeps its shape: only a rename goes through", () => {
    const newer = { ...cooler, template: "hex_rack_2031" };
    expect(legacyEditProblem(newer, { rows: 4 })).toBe("unknown_template");
    expect(legacyEditProblem(newer, { kind: "fridge" })).toBe("unknown_template");
  });

  it("every template accepts its own default size through the old API", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[id];
      const s = defaultStructure(id);
      expect(
        legacyEditProblem(
          { template: id, kind: t.kind, rows: s.rows, cols: s.cols, cellCapacity: s.cellCapacity },
          { rows: s.rows, cols: s.cols, kind: t.kind },
        ),
        id,
      ).toBeNull();
    }
  });
});

describe("what can be saved in this version (sprint 3)", () => {
  it("one bottle per cell, while depth is off; never more", () => {
    expect(DEPTH_PLACEMENT_ENABLED).toBe(false);
    expect(cellCapacitySavable(1)).toBe(true);
    for (const n of [2, 3, 8, 16]) expect(cellCapacitySavable(n)).toBe(false);
  });

  it("a template that starts at two bottles per cell is preview only; the rest can be saved", () => {
    const previewOnly = STORAGE_TEMPLATE_IDS.filter((id) => !templateSavable(id));
    expect(previewOnly).toEqual(["rack_double_depth", "cube_modular", "diamond_bins"]);
    for (const id of previewOnly) expect(STORAGE_TEMPLATES[id].cellCapacity.min).toBeGreaterThan(1);
  });
});
