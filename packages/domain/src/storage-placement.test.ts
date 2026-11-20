import { describe, expect, it } from "vitest";
import { resolveStorage, type StoredStorage } from "./storage-compat";
import {
  SmartMoveSchema,
  SmartSpotSchema,
  SmartSwapSchema,
  cellChoices,
  landingSpot,
  placementMeaning,
  placementProblem,
  sameSpot,
  swapProblem,
  zoneSummaries,
  type Occupant,
} from "./storage-placement";

const place = (s: StoredStorage) => resolveStorage(s);
const LEGACY = place({ kind: "rack", rows: 3, cols: 4 });
const CLASSIC = place({
  kind: "rack",
  rows: 3,
  cols: 4,
  template: "rack_classic",
  semantics: "depth",
});
const DOUBLE = place({
  kind: "rack",
  rows: 2,
  cols: 3,
  template: "rack_double_depth",
  cellCapacity: 3,
  semantics: "depth",
});
const BINS = place({
  kind: "rack",
  rows: 2,
  cols: 2,
  template: "diamond_bins",
  cellCapacity: 4,
  semantics: "ordinal",
});
const UNKNOWN = place({
  kind: "rack",
  rows: 2,
  cols: 2,
  template: "hex_rack_2031",
  cellCapacity: 1,
  semantics: "depth",
});
const COOLER = place({
  kind: "fridge",
  rows: 6,
  cols: 2,
  template: "cooler_dual",
  semantics: "depth",
  zones: [
    { fromRow: 1, toRow: 2, purpose: "serving", targetTempC: 8 },
    { fromRow: 3, toRow: 6, purpose: "storage", targetTempC: null },
  ],
});
const at = (bottleId: string, row: number, col: number, index = 1): Occupant => ({
  bottleId,
  row,
  col,
  index,
});
const ON = { depthEnabled: true };
const LOC = "00000000-0000-4000-8000-000000000001";

describe("what an index means, for placing", () => {
  it("single, depth, ordinal and unknown, truthfully", () => {
    expect(placementMeaning(LEGACY)).toBe("single");
    expect(placementMeaning(CLASSIC)).toBe("single");
    expect(placementMeaning(DOUBLE)).toBe("depth");
    expect(placementMeaning(BINS)).toBe("ordinal");
    expect(placementMeaning(UNKNOWN)).toBe("unknown");
  });
});

describe("single: one spot per cell, index 1", () => {
  it("free and taken, and nothing past index 1", () => {
    const cells = cellChoices(LEGACY, [at("a", 1, 1)]);
    expect(cells).toHaveLength(12);
    expect(cells[0]!.spots.map((s) => s.state)).toEqual(["taken"]);
    expect(cells[1]!.spots.map((s) => s.state)).toEqual(["free"]);
    expect(placementProblem(LEGACY, [at("a", 1, 1)], { row: 1, col: 1, index: 1 })).toBe(
      "occupied",
    );
    expect(placementProblem(LEGACY, [], { row: 1, col: 2, index: 1 })).toBeNull();
    expect(placementProblem(LEGACY, [], { row: 1, col: 2, index: 2 })).toBe("out_of_bounds");
    expect(placementProblem(LEGACY, [], { row: 4, col: 1 })).toBe("out_of_bounds");
    expect(placementProblem(LEGACY, [], { row: 0, col: 1 })).toBe("out_of_bounds");
  });

  it("the bottle being moved is on its own spot: same spot, not occupied", () => {
    expect(placementProblem(LEGACY, [at("a", 1, 1)], { row: 1, col: 1 }, { movingId: "a" })).toBe(
      "same_spot",
    );
    expect(cellChoices(LEGACY, [at("a", 1, 1)], { movingId: "a" })[0]!.spots[0]!.state).toBe(
      "current",
    );
  });
});

describe("depth: a physical position, 1 the front", () => {
  it("while depth is off, only the front is offered; behind is never a target", () => {
    const cells = cellChoices(DOUBLE, [at("a", 1, 1, 1)]);
    expect(cells[0]!.spots.map((s) => s.state)).toEqual(["taken", "depth_off", "depth_off"]);
    expect(cells[1]!.spots.map((s) => s.state)).toEqual(["free", "depth_off", "depth_off"]);
    expect(placementProblem(DOUBLE, [], { row: 1, col: 2, index: 2 })).toBe("depth_not_enabled");
  });

  it("with depth on (an isolated test): index 2 and 3 are spots, a spot behind a taken front is not offered", () => {
    const occupants = [at("a", 1, 1, 1), at("b", 1, 2, 2)];
    const cells = cellChoices(DOUBLE, occupants, ON);
    expect(cells[0]!.spots.map((s) => s.state)).toEqual(["taken", "behind", "behind"]);
    expect(cells[1]!.spots.map((s) => s.state)).toEqual(["free", "taken", "behind"]);
    expect(placementProblem(DOUBLE, occupants, { row: 1, col: 1, index: 2 }, ON)).toBe(
      "behind_taken",
    );
    expect(placementProblem(DOUBLE, occupants, { row: 1, col: 3, index: 3 }, ON)).toBeNull();
    expect(placementProblem(DOUBLE, occupants, { row: 1, col: 2, index: 2 }, ON)).toBe("occupied");
    expect(placementProblem(DOUBLE, occupants, { row: 1, col: 1, index: 4 }, ON)).toBe(
      "out_of_bounds",
    );
    // used and free per cell
    expect(cells[1]).toMatchObject({ used: 1, free: 2, capacity: 3 });
  });

  it("moving the front bottle back frees the way behind it for itself", () => {
    const occupants = [at("a", 1, 1, 1)];
    expect(
      placementProblem(DOUBLE, occupants, { row: 1, col: 1, index: 2 }, { ...ON, movingId: "a" }),
    ).toBeNull();
  });
});

describe("ordinal: a counter in a compartment, never a position", () => {
  const occupants = [at("a", 1, 1, 1), at("b", 1, 1, 3)];

  it("no spots are offered, only the compartment's next free counter and how full it is", () => {
    const cells = cellChoices(BINS, occupants, ON);
    expect(cells[0]!.spots).toEqual([]);
    expect(cells[0]).toMatchObject({ used: 2, free: 2, next: { row: 1, col: 1, index: 2 } });
    // sparse counters are kept as they are: nothing is renumbered
    expect(landingSpot(BINS, occupants, { row: 1, col: 1 })).toEqual({ row: 1, col: 1, index: 2 });
  });

  it("a full compartment is said as full, and a counter that is taken is not an error", () => {
    const full = [at("a", 1, 1, 1), at("b", 1, 1, 2), at("c", 1, 1, 3), at("d", 1, 1, 4)];
    expect(placementProblem(BINS, full, { row: 1, col: 1, index: 1 }, ON)).toBe("compartment_full");
    expect(cellChoices(BINS, full, ON)[0]!.next).toBeNull();
    expect(placementProblem(BINS, occupants, { row: 1, col: 1, index: 1 }, ON)).toBeNull();
  });

  it("with depth off a compartment past its first counter is not offered", () => {
    expect(cellChoices(BINS, [at("a", 1, 1, 1)])[0]!.next).toBeNull();
    expect(cellChoices(BINS, [])[0]!.next).toEqual({ row: 1, col: 1, index: 1 });
    // and refused by the rules, whatever counter the request named: the landing counter would be 2
    expect(placementProblem(BINS, [at("a", 1, 1, 1)], { row: 1, col: 1, index: 1 })).toBe(
      "depth_not_enabled",
    );
    expect(placementProblem(BINS, [], { row: 1, col: 1, index: 1 })).toBeNull();
  });

  it("two bottles of one compartment do not trade counters", () => {
    const spot = (index: number) => ({ locationId: LOC, row: 1, col: 1, index });
    expect(
      swapProblem(
        { bottleId: "a", spot: spot(1), meaning: "ordinal" },
        { bottleId: "b", spot: spot(3), meaning: "ordinal" },
        ON,
      ),
    ).toBe("same_compartment");
  });
});

describe("unknown arrangement: nothing is claimed, nothing is offered", () => {
  it("every spot is unknown, and no target is accepted", () => {
    const cells = cellChoices(UNKNOWN, [at("a", 1, 1)]);
    expect(cells.flatMap((c) => c.spots.map((s) => s.state))).toEqual([
      "unknown",
      "unknown",
      "unknown",
      "unknown",
    ]);
    expect(placementProblem(UNKNOWN, [], { row: 2, col: 2 })).toBe("unknown_arrangement");
    const spot = { locationId: LOC, row: 1, col: 1, index: 1 };
    expect(
      swapProblem(
        { bottleId: "a", spot, meaning: "unknown" },
        { bottleId: "b", spot: { ...spot, col: 2 }, meaning: "single" },
      ),
    ).toBe("unknown_arrangement");
  });
});

describe("swaps", () => {
  const spot = (col: number, index = 1) => ({ locationId: LOC, row: 1, col, index });
  it("two placed bottles of known places may trade; not with themselves; not past index 1 while depth is off", () => {
    expect(
      swapProblem(
        { bottleId: "a", spot: spot(1), meaning: "single" },
        { bottleId: "b", spot: spot(2), meaning: "depth" },
      ),
    ).toBeNull();
    expect(
      swapProblem(
        { bottleId: "a", spot: spot(1), meaning: "single" },
        { bottleId: "a", spot: spot(2), meaning: "single" },
      ),
    ).toBe("same_bottle");
    expect(
      swapProblem(
        { bottleId: "a", spot: spot(1, 2), meaning: "depth" },
        { bottleId: "b", spot: spot(2), meaning: "depth" },
      ),
    ).toBe("depth_not_enabled");
  });
});

describe("zones in daily use", () => {
  it("each zone with its shelves, purpose, set temperature (or none) and the bottles on it", () => {
    const zones = zoneSummaries(COOLER, [at("a", 1, 1), at("b", 2, 2), at("c", 6, 1)]);
    expect(zones).toEqual([
      {
        fromRow: 1,
        toRow: 2,
        purpose: "serving",
        targetTempC: 8,
        number: 1,
        bottles: 2,
        capacity: 4,
      },
      {
        fromRow: 3,
        toRow: 6,
        purpose: "storage",
        targetTempC: null,
        number: 2,
        bottles: 1,
        capacity: 8,
      },
    ]);
    // the zone of each cell, boundary shelves included
    const cells = cellChoices(COOLER, []);
    expect(cells.find((c) => c.row === 2)!.zone!.purpose).toBe("serving");
    expect(cells.find((c) => c.row === 3)!.zone!.purpose).toBe("storage");
  });

  it("a place without zones has none: no temperature is ever invented", () => {
    expect(zoneSummaries(CLASSIC, [at("a", 1, 1)])).toEqual([]);
    expect(cellChoices(CLASSIC, []).every((c) => c.zone === null)).toBe(true);
  });
});

describe("the contract", () => {
  it("a whole spot, strictly", () => {
    expect(SmartSpotSchema.safeParse({ locationId: LOC, row: 1, col: 1, index: 1 }).success).toBe(
      true,
    );
    for (const bad of [
      { locationId: LOC, row: 1, col: 1 },
      { locationId: "x", row: 1, col: 1, index: 1 },
      { locationId: LOC, row: 0, col: 1, index: 1 },
      { locationId: LOC, row: 1, col: 1, index: 17 },
      { locationId: LOC, row: 1, col: 1, index: 1.5 },
      { locationId: LOC, row: 1, col: 1, index: 1, householdId: LOC },
    ])
      expect(SmartSpotSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(SmartMoveSchema.safeParse({ from: null, to: null }).success).toBe(true);
    expect(SmartMoveSchema.safeParse({ to: null }).success).toBe(false);
    expect(
      SmartSwapSchema.safeParse({
        with: LOC,
        expected: {
          self: { locationId: LOC, row: 1, col: 1, index: 1 },
          other: { locationId: LOC, row: 1, col: 2, index: 1 },
        },
      }).success,
    ).toBe(true);
    expect(sameSpot(null, null)).toBe(true);
    expect(sameSpot({ locationId: LOC, row: 1, col: 1, index: 1 }, null)).toBe(false);
  });
});
