import { describe, expect, it } from "vitest";
import {
  DEPTH_PLACEMENT_ENABLED,
  cellCapacitySavable,
  cellCapacitySavableWith,
  depthBlockOf,
  layoutChangeProblem,
  readDepthStatus,
  templateSavable,
  templateSavableWith,
} from "./smart-cellar";
import { defaultStorageConfig } from "./storage-config";
import { resolveStorage } from "./storage-compat";
import {
  cellChoices,
  landingSpot,
  placementMeaning,
  placementProblem,
  reachable,
  swapProblem,
  type Occupant,
} from "./storage-placement";
import { STORAGE_TEMPLATES, STORAGE_TEMPLATE_IDS } from "./storage-templates";

/**
 * DEPTH (Smart Cellar 3D, sprint 9; ADR-011): every rule of more than one bottle per cell, for every template that
 * can hold more than one, with depth OFF (the default everywhere: nothing may change) and ON (the server decided it).
 */
const DEEP_TEMPLATES = STORAGE_TEMPLATE_IDS.filter(
  (id) => STORAGE_TEMPLATES[id].cellCapacity.max > 1,
);

const resolvedOf = (id: (typeof STORAGE_TEMPLATE_IDS)[number], cellCapacity: number) => {
  const t = STORAGE_TEMPLATES[id];
  const config = defaultStorageConfig(id);
  return resolveStorage({
    kind: t.kind,
    rows: config.structure.rows,
    cols: config.structure.cols,
    template: id,
    cellCapacity,
    semantics: t.semantics,
  });
};

describe("which templates are deep, and what their index means (pinned)", () => {
  it("the templates that hold more than one bottle per cell, with the meaning of their index", () => {
    expect(
      Object.fromEntries(DEEP_TEMPLATES.map((id) => [id, STORAGE_TEMPLATES[id].semantics])),
    ).toEqual(
      Object.fromEntries(
        DEEP_TEMPLATES.map((id) => [
          id,
          STORAGE_TEMPLATES[id].semantics === "ordinal" ? "ordinal" : "depth",
        ]),
      ),
    );
    expect(DEEP_TEMPLATES).toEqual(
      expect.arrayContaining(["rack_double_depth", "cube_modular", "diamond_bins"]),
    );
  });
});

describe("depth OFF (the default): nothing past index 1 is savable or offered", () => {
  it("the compile-time switch is still off", () => expect(DEPTH_PLACEMENT_ENABLED).toBe(false));

  for (const id of DEEP_TEMPLATES) {
    const t = STORAGE_TEMPLATES[id];
    const deep = Math.max(2, t.cellCapacity.min);
    it(`${id}: ${deep} per cell is not savable, a layout of it is refused, index 2 is not offered`, () => {
      expect(cellCapacitySavable(deep)).toBe(false);
      expect(templateSavable(id)).toBe(t.cellCapacity.min <= 1);
      const structure = { ...defaultStorageConfig(id).structure, cellCapacity: deep };
      expect(
        layoutChangeProblem({ rows: 1, cols: 1, cellCapacity: 1, semantics: null }, structure, []),
      ).toBe("depth_not_enabled");
      const r = resolvedOf(id, deep);
      expect(placementProblem(r, [], { row: 1, col: 1, index: 2 })).toBe(
        placementMeaning(r) === "unknown" ? "unknown_arrangement" : "depth_not_enabled",
      );
    });
  }
});

describe("depth ON (decided by the server): savable, placeable, by the meaning of the index", () => {
  const on = { depthEnabled: true };

  for (const id of DEEP_TEMPLATES) {
    const t = STORAGE_TEMPLATES[id];
    const deep = Math.max(2, t.cellCapacity.min);
    it(`${id}: savable at ${deep} per cell, and its layout passes the database's own rules`, () => {
      expect(cellCapacitySavableWith(deep, true)).toBe(true);
      expect(templateSavableWith(id, true)).toBe(true);
      const structure = { ...defaultStorageConfig(id).structure, cellCapacity: deep };
      expect(
        layoutChangeProblem(
          { rows: 1, cols: 1, cellCapacity: 1, semantics: null },
          structure,
          [],
          on,
        ),
      ).toBeNull();
      // still never shallower than a bottle at the back needs
      expect(
        layoutChangeProblem(
          {
            rows: structure.rows,
            cols: structure.cols,
            cellCapacity: deep,
            semantics: t.semantics,
          },
          { ...structure, cellCapacity: deep - 1 },
          [{ row: 1, col: 1, index: deep }],
          on,
        ),
      ).toBe("in_use");
    });

    it(`${id}: placing and reaching a bottle follows what the index means`, () => {
      const r = resolvedOf(id, deep);
      const front: Occupant = { bottleId: "front", row: 1, col: 1, index: 1 };
      if (t.semantics === "ordinal") {
        // a bin: a counter is never a place. Putting a bottle in goes to the next free counter; all reachable.
        expect(placementProblem(r, [front], { row: 1, col: 1, index: 1 }, on)).toBeNull();
        expect(landingSpot(r, [front], { row: 1, col: 1, index: 1 })).toEqual({
          row: 1,
          col: 1,
          index: 2,
        });
        expect(
          reachable(r, [front, { bottleId: "b", row: 1, col: 1, index: 2 }], {
            row: 1,
            col: 1,
            index: 2,
          }),
        ).toBe(true);
        const cell = cellChoices(r, [front], on).find((c) => c.row === 1 && c.col === 1)!;
        expect(cell.spots).toEqual([]);
        expect(cell.next).toEqual({ row: 1, col: 1, index: 2 });
        // two counters of one bin do not trade places
        const spot = (index: number) => ({
          locationId: "00000000-0000-4000-8000-000000000001",
          row: 1,
          col: 1,
          index,
        });
        expect(
          swapProblem(
            { bottleId: "a", spot: spot(1), meaning: "ordinal" },
            { bottleId: "b", spot: spot(2), meaning: "ordinal" },
            on,
          ),
        ).toBe("same_compartment");
      } else {
        // depth: 1 is the front. A spot is offered only while everything in front of it is free (a bottle cannot
        // pass through another); a bottle behind a taken front is not reachable.
        expect(placementProblem(r, [], { row: 1, col: 1, index: 2 }, on)).toBeNull();
        expect(placementProblem(r, [front], { row: 1, col: 1, index: 2 }, on)).toBe("behind_taken");
        expect(placementProblem(r, [front], { row: 1, col: 1, index: 1 }, on)).toBe("occupied");
        const back: Occupant = { bottleId: "back", row: 1, col: 1, index: 2 };
        expect(reachable(r, [front, back], back)).toBe(false);
        expect(reachable(r, [back], back)).toBe(true);
        expect(reachable(r, [front, back], back, ["front"])).toBe(true);
        expect(reachable(r, [front, back], front)).toBe(true);
        const cell = cellChoices(r, [front], on).find((c) => c.row === 1 && c.col === 1)!;
        expect(cell.spots.map((s) => s.state)).toEqual(
          Array.from({ length: deep }, (_, i) => (i === 0 ? "taken" : "behind")),
        );
      }
    });
  }

  it("a swap across depths is allowed only with depth on", () => {
    const at = (index: number) => ({
      locationId: "00000000-0000-4000-8000-000000000001",
      row: 1,
      col: 1,
      index,
    });
    const a = { bottleId: "a", spot: at(2), meaning: "depth" as const };
    const b = { bottleId: "b", spot: { ...at(1), col: 2 }, meaning: "depth" as const };
    expect(swapProblem(a, b)).toBe("depth_not_enabled");
    expect(swapProblem(a, b, on)).toBeNull();
  });

  it("a place of one bottle per cell, and one whose arrangement is unknown, are always reachable", () => {
    const single = resolveStorage({ kind: "rack", rows: 2, cols: 2 });
    expect(
      reachable(single, [{ bottleId: "x", row: 1, col: 1, index: 1 }], {
        row: 1,
        col: 1,
        index: 1,
      }),
    ).toBe(true);
    const unknown = resolveStorage({
      kind: "rack",
      rows: 2,
      cols: 2,
      template: "no_such_thing",
      cellCapacity: 2,
      semantics: "depth",
    });
    expect(placementMeaning(unknown)).toBe("unknown");
    expect(
      reachable(unknown, [{ bottleId: "f", row: 1, col: 1, index: 1 }], {
        row: 1,
        col: 1,
        index: 2,
      }),
    ).toBe(true);
  });
});

describe("what the database says about depth (0054), read strictly", () => {
  const all = {
    depth_placement: true,
    legacy_cell_index: false,
    index_unique: true,
    move_v2: true,
  };

  it("on only when all four facts say so", () => {
    expect(depthBlockOf(readDepthStatus(all))).toBeNull();
    expect(depthBlockOf(readDepthStatus({ ...all, depth_placement: false }))).toBe(
      "database_switch_off",
    );
    expect(depthBlockOf(readDepthStatus({ ...all, legacy_cell_index: true }))).toBe("legacy_index");
    expect(depthBlockOf(readDepthStatus({ ...all, index_unique: false }))).toBe("index_missing");
    expect(depthBlockOf(readDepthStatus({ ...all, move_v2: false }))).toBe("move_missing");
    // production today: switch off and the old index in force
    expect(
      depthBlockOf(readDepthStatus({ ...all, depth_placement: false, legacy_cell_index: true })),
    ).toBe("database_switch_off");
  });

  it("anything that is not exactly the four booleans is 'cannot say', never 'on'", () => {
    for (const bad of [
      null,
      undefined,
      "on",
      1,
      [],
      {},
      { ...all, move_v2: "true" },
      { ...all, depth_placement: 1 },
    ])
      expect(depthBlockOf(readDepthStatus(bad)), JSON.stringify(bad)).toBe("database_unknown");
  });
});
