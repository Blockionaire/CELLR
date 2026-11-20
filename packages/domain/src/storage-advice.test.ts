import { describe, expect, it } from "vitest";
import {
  ADVICE_WEIGHTS,
  adviseStorage,
  type AdviceBottle,
  type AdviceInput,
  type AdviceOccupant,
  type AdvicePlace,
  type AdviceResult,
} from "./storage-advice";
import { resolveStorage, type StoredStorage } from "./storage-compat";
import { placementProblem } from "./storage-placement";

const resolved = (s: StoredStorage) => resolveStorage(s);
const place = (id: string, label: string, s: StoredStorage): AdvicePlace => ({
  id,
  label,
  resolved: resolved(s),
});
const RACK = place("rack", "Oak rack", {
  kind: "rack",
  rows: 3,
  cols: 4,
  template: "rack_classic",
  semantics: "depth",
});
const COOLER = place("cooler", "Wine cooler", {
  kind: "fridge",
  rows: 4,
  cols: 2,
  template: "cooler_dual",
  semantics: "depth",
  zones: [
    { fromRow: 1, toRow: 2, purpose: "serving", targetTempC: 8 },
    { fromRow: 3, toRow: 4, purpose: "storage", targetTempC: null },
  ],
});
const DOUBLE = place("double", "Two-deep", {
  kind: "rack",
  rows: 1,
  cols: 2,
  template: "rack_double_depth",
  cellCapacity: 2,
  semantics: "depth",
});
const BINS = place("bins", "Bins", {
  kind: "rack",
  rows: 1,
  cols: 2,
  template: "diamond_bins",
  cellCapacity: 4,
  semantics: "ordinal",
});
const UNKNOWN = place("odd", "Odd rack", {
  kind: "rack",
  rows: 2,
  cols: 2,
  template: "hex_rack_2031",
  semantics: "depth",
});
const LEGACY = place("old", "Old fridge", { kind: "fridge", rows: 2, cols: 2 });

const BOTTLE: AdviceBottle = {
  bottleId: "me",
  inCellar: true,
  vintageId: "v1",
  wineId: "w1",
  producerId: "p1",
  type: "red",
  year: 2015,
  current: null,
};
let n = 0;
const occ = (
  locationId: string,
  row: number,
  col: number,
  over: Partial<AdviceOccupant> = {},
): AdviceOccupant => ({
  bottleId: `o${++n}`,
  locationId,
  row,
  col,
  index: 1,
  vintageId: "vx",
  wineId: "wx",
  producerId: "px",
  type: "white",
  ...over,
});
const advise = (over: Partial<AdviceInput> = {}): AdviceResult =>
  adviseStorage({
    bottle: BOTTLE,
    places: [RACK],
    occupants: [],
    intent: "store",
    depthEnabled: false,
    ...over,
  });
const all = (r: AdviceResult) => [...r.recommendations, ...r.alternatives];
const key = (s: { spot: { locationId: string; row: number; col: number; index: number } }) =>
  `${s.spot.locationId}:${s.spot.row}:${s.spot.col}:${s.spot.index}`;

describe("hard eligibility is Sprint 4's", () => {
  it("never an occupied spot; every recommendation passes placementProblem with the same options", () => {
    const occupants = [occ("rack", 1, 1), occ("rack", 1, 2), occ("cooler", 1, 1)];
    const r = advise({ places: [RACK, COOLER, DOUBLE, BINS, LEGACY], occupants });
    expect(r.status).toBe("ok");
    const taken = new Set(occupants.map((o) => `${o.locationId}:${o.row}:${o.col}:1`));
    for (const s of all(r)) {
      expect(taken.has(key(s))).toBe(false);
      const p = [RACK, COOLER, DOUBLE, BINS, LEGACY].find((x) => x.id === s.spot.locationId)!;
      const inPlace = occupants.filter((o) => o.locationId === p.id);
      expect(
        placementProblem(p.resolved, inPlace, s.spot, { movingId: "me", depthEnabled: false }),
      ).toBeNull();
      expect(s.actionable).toBe(true);
    }
    expect(r.excluded.occupied).toBe(3);
  });

  it("an unknown arrangement is never advised on; depth-off and behind spots are counted, never offered", () => {
    const r = advise({ places: [UNKNOWN, DOUBLE], occupants: [occ("double", 1, 1)] });
    expect(r.excluded.unknownPlaces).toBe(1);
    expect(all(r).every((s) => s.spot.locationId === "double" && s.spot.index === 1)).toBe(true);
    // two cells × index 2 are past the depth switch
    expect(r.excluded.depthOff).toBe(2);
    expect(all(r).map(key)).toEqual(["double:1:2:1"]);
  });

  it("with depth on, a spot behind a taken front is still never offered", () => {
    const r = advise({ places: [DOUBLE], occupants: [occ("double", 1, 1)], depthEnabled: true });
    expect(all(r).map(key)).not.toContain("double:1:1:2");
    expect(r.excluded.behind).toBe(1);
  });

  it("ordinal: a compartment is one candidate at its next counter; a filled one needs depth; a full one is excluded", () => {
    const one = advise({ places: [BINS], occupants: [occ("bins", 1, 1)] });
    // depth off: the compartment holding a bottle can't take one at counter 2
    expect(all(one).map(key)).toEqual(["bins:1:2:1"]);
    const on = advise({ places: [BINS], occupants: [occ("bins", 1, 1)], depthEnabled: true });
    // both compartments are eligible; nothing tells them apart, so one is shown with the other counted as equivalent
    expect(on.eligible).toBe(2);
    expect(on.recommendations[0]!.equivalent).toBe(1);
    const full = advise({
      places: [BINS],
      depthEnabled: true,
      occupants: [1, 2, 3, 4].map((i) => occ("bins", 1, 1, { index: i })),
    });
    expect(full.excluded.fullCompartments).toBe(1);
    expect(all(full).map(key)).toEqual(["bins:1:2:1"]);
    expect(all(one)[0]!.caveats.map((c) => c.code)).toContain("compartment_counter");
    expect(all(one)[0]!.reasons.map((c) => c.code)).not.toContain("front_reachable");
  });

  it("only the places given are ever advised (the server gives only the household's own)", () => {
    const r = advise({ places: [LEGACY], occupants: [occ("elsewhere", 1, 1)] });
    expect(all(r).every((s) => s.spot.locationId === "old")).toBe(true);
  });

  it("nothing free: no_eligible, nothing invented; no places: no_places; gone: not_in_cellar", () => {
    const occupants = [1, 2].flatMap((row) => [1, 2].map((col) => occ("old", row, col)));
    expect(advise({ places: [LEGACY], occupants })).toMatchObject({
      status: "no_eligible",
      recommendations: [],
      alternatives: [],
    });
    expect(advise({ places: [] }).status).toBe("no_places");
    expect(advise({ bottle: { ...BOTTLE, inCellar: false } }).status).toBe("not_in_cellar");
    expect(advise({ places: [UNKNOWN] }).status).toBe("no_eligible");
  });
});

describe("ranking", () => {
  it("is deterministic: the same input gives the same order, and ties go by place order then row, col, index", () => {
    const input = { places: [LEGACY, RACK], occupants: [] };
    const a = advise(input);
    expect(advise(input)).toEqual(a);
    // nothing tells them apart: the first place's first spot first
    expect(key(a.recommendations[0]!)).toBe("old:1:1:1");
    expect(a.recommendations[0]!.equivalent).toBeGreaterThan(0);
  });

  it("intent changes the ranking for a stated reason: the zone set aside for it", () => {
    const store = advise({ places: [COOLER] });
    expect(store.recommendations[0]!.spot.row).toBeGreaterThanOrEqual(3);
    expect(store.recommendations[0]!.reasons).toContainEqual({
      code: "purpose_match",
      purpose: "storage",
      zone: 2,
    });
    const serve = advise({ places: [COOLER], intent: "serve" });
    expect(serve.recommendations[0]!.spot.row).toBeLessThanOrEqual(2);
    expect(serve.recommendations[0]!.suitability).toBe("strong");
    // the other zone is said to be for the other purpose, not hidden
    const other = all(store).find((s) => s.spot.row <= 2)!;
    expect(other.caveats).toContainEqual({ code: "purpose_mismatch", purpose: "serving", zone: 1 });
    expect(other.score).toBe(ADVICE_WEIGHTS.purposeMismatch);
  });

  it("groups identical bottles: next to the same vintage beats an empty shelf; tiers do not stack", () => {
    const occupants = [
      occ("rack", 2, 2, { vintageId: "v1", wineId: "w1", producerId: "p1", type: "red" }),
      occ("rack", 3, 4, { wineId: "w1", producerId: "p1", type: "red" }),
    ];
    const r = advise({ occupants });
    const top = r.recommendations[0]!;
    expect(Math.abs(top.spot.row - 2) <= 1 && Math.abs(top.spot.col - 2) <= 1).toBe(true);
    expect(top.reasons).toContainEqual({
      code: "group",
      tier: "vintage",
      proximity: "neighbour",
      count: 1,
    });
    expect(top.score).toBe(ADVICE_WEIGHTS.group.vintage.neighbour);
    expect(top.suitability).toBe("strong");
  });

  it("without grouping evidence or zones it still works, and says it is limited", () => {
    const r = advise({ places: [LEGACY] });
    expect(r.recommendations[0]!.suitability).toBe("limited");
    expect(r.recommendations[0]!.caveats.map((c) => c.code)).toEqual(
      expect.arrayContaining(["no_zone", "no_grouping_evidence"]),
    );
  });

  it("does not advise a move without a clear advantage: staying is the answer", () => {
    const here = { locationId: "rack", row: 1, col: 1, index: 1 };
    const r = advise({
      bottle: { ...BOTTLE, current: here },
      occupants: [occ("rack", 1, 1, { bottleId: "me", vintageId: "v1" })],
    });
    expect(r.stay?.spot).toEqual(here);
    expect(r.stay?.reasons.map((x) => x.code)).toContain("current_spot");
    // free spots remain listed for a person who wants to move anyway
    expect(r.recommendations.length).toBeGreaterThan(0);
  });

  it("advises a move when a free spot is clearly better (next to its twins in a keeping zone)", () => {
    const here = { locationId: "rack", row: 1, col: 1, index: 1 };
    const r = advise({
      bottle: { ...BOTTLE, current: here },
      places: [RACK, COOLER],
      occupants: [
        occ("rack", 1, 1, { bottleId: "me", vintageId: "v1" }),
        occ("cooler", 3, 1, { vintageId: "v1", wineId: "w1" }),
      ],
    });
    expect(r.stay).toBeNull();
    expect(r.recommendations[0]!.spot.locationId).toBe("cooler");
  });

  it("returns at most three recommendations and a bounded list of alternatives, all distinct", () => {
    const r = advise({ places: [RACK, COOLER, LEGACY, DOUBLE, BINS] });
    expect(r.recommendations.length).toBeLessThanOrEqual(3);
    expect(r.alternatives.length).toBeLessThanOrEqual(5);
    const keys = all(r).map(key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(all(r).map((s) => s.rank)).toEqual(keys.map((_, i) => i + 1));
  });
});

describe("explanations come only from facts", () => {
  it("delete the zone and its purpose and temperature reasons go with it", () => {
    const zoned = advise({ places: [COOLER] }).recommendations[0]!;
    expect(zoned.reasons.map((r) => r.code)).toContain("purpose_match");
    const bare = place("cooler", "Wine cooler", {
      kind: "fridge",
      rows: 4,
      cols: 2,
      template: "cooler_dual",
      semantics: "depth",
      zones: [],
    });
    const plain = advise({ places: [bare] }).recommendations[0]!;
    expect(plain.reasons.map((r) => r.code)).not.toContain("purpose_match");
    expect(plain.reasons.map((r) => r.code)).not.toContain("zone_target");
    expect(plain.caveats.map((r) => r.code)).toContain("no_zone");
  });

  it("delete the target temperature and its description goes; a set target is never called a measurement", () => {
    const serve = advise({ places: [COOLER], intent: "serve" }).recommendations[0]!;
    expect(serve.reasons).toContainEqual({ code: "zone_target", zone: 1, targetTempC: 8 });
    expect(serve.caveats).toContainEqual({ code: "temperature_not_measured" });
    const store = advise({ places: [COOLER] }).recommendations[0]!;
    expect(store.reasons.map((r) => r.code)).not.toContain("zone_target");
    expect(store.caveats).toContainEqual({ code: "zone_no_target", zone: 2 });
  });

  it("delete the matching bottle and the grouping reason goes", () => {
    const twin = occ("rack", 2, 2, { vintageId: "v1" });
    expect(
      advise({ occupants: [twin] }).recommendations[0]!.reasons.some((r) => r.code === "group"),
    ).toBe(true);
    expect(
      advise({ occupants: [] }).recommendations[0]!.reasons.some((r) => r.code === "group"),
    ).toBe(false);
  });

  it("delete the estimated window or the unknown year and their caveats go", () => {
    expect(advise({ bottle: { ...BOTTLE, drinkWindowSource: "estimate" } }).caveats).toContainEqual(
      {
        code: "estimated_window_not_used",
      },
    );
    expect(advise().caveats.map((c) => c.code)).not.toContain("estimated_window_not_used");
    expect(advise({ bottle: { ...BOTTLE, year: null } }).caveats).toContainEqual({
      code: "vintage_unknown",
    });
    expect(advise().caveats.map((c) => c.code)).not.toContain("vintage_unknown");
  });

  it("no zone for the intent anywhere: said once for the whole answer", () => {
    expect(advise({ places: [RACK] }).caveats).toContainEqual({
      code: "no_matching_zone",
      purpose: "storage",
    });
    expect(advise({ places: [COOLER] }).caveats.map((c) => c.code)).not.toContain(
      "no_matching_zone",
    );
  });

  it("front_reachable only for the front of a depth cell (never for single spots or compartments)", () => {
    expect(advise({ places: [DOUBLE] }).recommendations[0]!.reasons.map((r) => r.code)).toContain(
      "front_reachable",
    );
    for (const p of [RACK, LEGACY, BINS])
      expect(advise({ places: [p] }).recommendations[0]!.reasons.map((r) => r.code)).not.toContain(
        "front_reachable",
      );
  });

  it("no reason or caveat carries a number that isn't in the input", () => {
    const r = advise({
      places: [COOLER],
      intent: "serve",
      occupants: [occ("cooler", 1, 2, { type: "red" })],
    });
    for (const s of all(r))
      for (const x of [...s.reasons, ...s.caveats]) {
        if ("targetTempC" in x) expect(x.targetTempC).toBe(8);
        if ("count" in x) expect(x.count).toBe(1);
      }
  });
});

describe("review findings (sprint 5, phase F)", () => {
  it("staying put is only called suitable with positive evidence and no conflict; otherwise 'nothing better'", () => {
    // the bottle is in the serving zone, the person wants to keep it, the keeping zone is full
    const here = { locationId: "cooler", row: 1, col: 1, index: 1 };
    const full = [3, 4].flatMap((row) => [1, 2].map((col) => occ("cooler", row, col)));
    const r = advise({
      bottle: { ...BOTTLE, current: here },
      places: [COOLER],
      occupants: [occ("cooler", 1, 1, { bottleId: "me" }), ...full],
    });
    expect(r.stay?.spot).toEqual(here);
    expect(r.stayKind).toBe("nothing_better");
    // next to its twin, nothing better: suitable
    const twin = advise({
      bottle: { ...BOTTLE, current: { locationId: "rack", row: 1, col: 1, index: 1 } },
      occupants: [occ("rack", 1, 1, { bottleId: "me" }), occ("rack", 1, 2, { vintageId: "v1" })],
    });
    expect(twin.stayKind).toBe("suitable");
  });

  it("a compartment that only depth keeps closed is counted as depth, not as full", () => {
    const r = advise({ places: [BINS], occupants: [occ("bins", 1, 1), occ("bins", 1, 2)] });
    expect(r.status).toBe("no_eligible");
    expect(r.excluded).toMatchObject({ depthOff: 2, fullCompartments: 0 });
  });

  it("the bottle's own compartment is not a destination, and isn't counted as one", () => {
    const r = advise({
      bottle: { ...BOTTLE, current: { locationId: "bins", row: 1, col: 1, index: 1 } },
      places: [BINS],
      occupants: [occ("bins", 1, 1, { bottleId: "me" })],
    });
    expect(r.eligible).toBe(1);
    expect(all(r).map(key)).toEqual(["bins:1:2:1"]);
  });

  it("a bottle whose catalogue rows can't be read still occupies its spot, and is never 'related'", () => {
    const hidden = occ("rack", 1, 2, {
      vintageId: "vz",
      wineId: null,
      producerId: null,
      type: null,
    });
    const r = advise({
      occupants: [hidden],
      bottle: { ...BOTTLE, wineId: null, producerId: null, type: null },
    });
    expect(all(r).map(key)).not.toContain("rack:1:2:1");
    expect(r.excluded.occupied).toBe(1);
    expect(all(r).every((s) => !s.reasons.some((x) => x.code === "group"))).toBe(true);
  });

  it("a target in the zone for the other purpose is a fact about that zone, not a reason for the choice", () => {
    const other = all(advise({ places: [COOLER], intent: "store" })).find((s) => s.spot.row <= 2)!;
    expect(other.reasons.map((r) => r.code)).not.toContain("zone_target");
    expect(other.caveats).toContainEqual({ code: "zone_target", zone: 1, targetTempC: 8 });
  });

  it("a place whose arrangement is unknown doesn't count as having a zone for the intent", () => {
    const oddWithZone = place("odd2", "Odd cooler", {
      kind: "fridge",
      rows: 2,
      cols: 2,
      template: "hex_rack_2031",
      semantics: "depth",
      zones: [{ fromRow: 1, toRow: 2, purpose: "storage", targetTempC: null }],
    });
    expect(advise({ places: [RACK, oddWithZone] }).caveats).toContainEqual({
      code: "no_matching_zone",
      purpose: "storage",
    });
  });
});
