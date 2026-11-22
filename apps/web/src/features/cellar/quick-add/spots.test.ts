import { describe, expect, it } from "vitest";
import {
  STORAGE_TEMPLATES,
  STORAGE_TEMPLATE_IDS,
  cellChoices,
  placementProblem,
  resolveStorage,
  type Occupant,
  type StorageTemplateId,
} from "@cellr/domain";
import { buildModel } from "../storage3d/model";
import { freeSpots, spotKey, spotMarkers } from "./spots";

const place = (template: StorageTemplateId, rows = 3, cols = 4, cap?: number) => {
  const t = STORAGE_TEMPLATES[template];
  return resolveStorage({
    kind: t.kind,
    rows,
    cols,
    template,
    cellCapacity: cap ?? t.cellCapacity.min,
    semantics: t.semantics,
  });
};
const at = (row: number, col: number, index = 1, bottleId = `b${row}${col}${index}`): Occupant => ({
  bottleId,
  row,
  col,
  index,
});

describe("free spots: the domain's eligibility, never the rectangle", () => {
  it("a rack: every empty spot of index 1, none that is taken", () => {
    const resolved = place("rack_classic", 2, 3);
    const spots = freeSpots(resolved, [at(1, 1), at(2, 3)]);
    expect(spots.map(spotKey)).toEqual(["1:2:1", "1:3:1", "2:1:1", "2:2:1"]);
  });

  it("every spot offered is one the server would accept (placementProblem null), on every savable template", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[id];
      if (t.cellCapacity.min > 1) continue; // preview only while depth is off
      const resolved = place(id, 3, 3);
      const occupied = [at(1, 1), at(2, 2)].filter((o) =>
        resolved.layout.cells.some((c) => c.row === o.row && c.col === o.col),
      );
      for (const s of freeSpots(resolved, occupied))
        expect(placementProblem(resolved, occupied, s), `${id} ${spotKey(s)}`).toBeNull();
    }
  });

  it("nothing outside the layout's own cells (a diamond bin has no corners) and never past index 1", () => {
    const resolved = place("diamond_bins", 3, 3, 2);
    const cells = new Set(resolved.layout.cells.map((c) => `${c.row}:${c.col}`));
    for (const s of freeSpots(resolved, [])) {
      expect(cells.has(`${s.row}:${s.col}`)).toBe(true);
      expect(s.index).toBe(1);
    }
  });

  it("depth stays off: a double-depth rack offers the front spot only, and no spot behind a bottle", () => {
    const resolved = place("rack_double_depth", 2, 2, 2);
    const spots = freeSpots(resolved, [at(1, 1, 1)]);
    expect(spots.every((s) => s.index === 1)).toBe(true);
    expect(spots.map(spotKey)).not.toContain("1:1:1");
    expect(spots.map(spotKey)).not.toContain("1:1:2");
  });

  it("a compartment (ordinal) is offered only while its next counter is the first", () => {
    const resolved = place("crate_storage", 2, 2, 1);
    const spots = freeSpots(resolved, [at(1, 1)]);
    expect(spots.map(spotKey)).toEqual(["1:2:1", "2:1:1", "2:2:1"]);
  });

  it("an unknown arrangement offers nothing to point at", () => {
    const resolved = resolveStorage({
      kind: "rack",
      rows: 2,
      cols: 2,
      template: "hex_rack_2031",
      cellCapacity: 1,
      semantics: "single",
    });
    expect(freeSpots(resolved, [])).toEqual([]);
  });

  it("a full place has no free spot", () => {
    const resolved = place("rack_classic", 1, 2);
    expect(freeSpots(resolved, [at(1, 1), at(1, 2)])).toEqual([]);
  });

  it("agrees with the 2D picker's free spots exactly (same source)", () => {
    const resolved = place("cooler_dual", 4, 3);
    const occupied = [at(1, 1), at(3, 2)];
    const fromPicker = cellChoices(resolved, occupied)
      .flatMap((c) => c.spots)
      .filter((s) => s.state === "free" && s.address.index === 1)
      .map((s) => spotKey(s.address));
    expect(freeSpots(resolved, occupied).map(spotKey)).toEqual(fromPicker);
  });
});

describe("markers: in 3D only where the picture has an exact place for the spot", () => {
  it("racks, shelves, cabinets, coolers, pegs and rails: one marker per free spot, with a bottle's own pose", () => {
    for (const id of [
      "rack_classic",
      "rack_metal",
      "shelving_open",
      "cabinet_closed",
      "cooler_single",
      "cooler_dual",
      "cooler_undercounter",
      "wall_pegs",
      "wall_rails",
      "rack_generic",
    ] as const) {
      const model = buildModel(place(id, 3, 3));
      const spots = freeSpots(model.resolved, [at(1, 1)]);
      const markers = spotMarkers(model, spots);
      expect(markers, id).not.toBeNull();
      expect(markers!.length).toBe(spots.length);
      for (const m of markers!)
        expect(m.pose).toEqual(model.built.poseOf!(m.spot.row, m.spot.col, 1));
    }
  });

  it("crates at one per compartment: the compartment's one place", () => {
    const model = buildModel(place("crate_storage", 2, 2, 1));
    const markers = spotMarkers(model, freeSpots(model.resolved, []));
    expect(markers).not.toBeNull();
    expect(markers).toHaveLength(4);
  });

  it("bins of several and the neutral picture: no markers (the 2D list instead)", () => {
    const bins = buildModel(place("diamond_bins", 2, 2, 4));
    expect(spotMarkers(bins, freeSpots(bins.resolved, []))).toBeNull();
    const neutral = buildModel(
      resolveStorage({
        kind: "rack",
        rows: 2,
        cols: 2,
        template: "hex_rack_2031",
        cellCapacity: 1,
        semantics: "single",
      }),
    );
    expect(spotMarkers(neutral, [])).toBeNull();
  });

  it("a place from before templates is drawn by the existing view: no markers here", () => {
    const legacy = buildModel(resolveStorage({ kind: "rack", rows: 2, cols: 2 }));
    expect(spotMarkers(legacy, [])).toBeNull();
  });
});
