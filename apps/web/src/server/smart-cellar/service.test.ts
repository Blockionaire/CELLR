import { describe, expect, it } from "vitest";
import {
  STALE_LAYOUT_MESSAGE,
  SMART_CELLAR_NOT_SET_UP,
  type AdviceOccupant,
  type DepthDatabaseStatus,
  type SmartSpot,
  STORAGE_TEMPLATES,
  STORAGE_TEMPLATE_IDS,
  defaultAppearance,
  defaultStructure,
  isDomainError,
  resolveStorage,
  type OccupiedSpot,
  type SmartPlacementView,
  type StorageConfig,
} from "@cellr/domain";
import {
  isSchemaMissing,
  mapSmartCellarError,
  toPlacement,
  toStoredPlace,
  zonesForRpc,
} from "./repository";
import { PLACEMENT_CLOSED } from "@/lib/smart-cellar-placement-gate";
import { createSmartCellarService, toUnitView } from "./service";
import type {
  AdviceBottleRow,
  MoveOutcome,
  OccupantRow,
  SwapOutcome,
  LayoutWrite,
  SaveLayoutOutcome,
  SmartCellarRepository,
  StoredPlaceRow,
} from "./types";

const HOUSEHOLD = { id: "h-1", currency: "EUR" };
const OPEN = { reads: true, writes: true };

const place = (over: Partial<StoredPlaceRow> = {}): StoredPlaceRow => ({
  id: "p-1",
  label: "Rack",
  kind: "rack",
  rows: 5,
  cols: 8,
  template: null,
  cellCapacity: 1,
  semantics: null,
  appearance: null,
  zones: [],
  occupied: 0,
  revision: "2026-11-19 08:00:00+00",
  ...over,
});

/** A repository in memory: one household, the places given, and a record of every layout write. */
function fakeRepo(
  places: StoredPlaceRow[],
  options: {
    spots?: OccupiedSpot[];
    placements?: SmartPlacementView[];
    outcome?: SaveLayoutOutcome;
    schema?: Awaited<ReturnType<SmartCellarRepository["schemaStatus"]>>;
    occupants?: OccupantRow[];
    move?: MoveOutcome;
    swap?: SwapOutcome;
    /** What the bottle read answers (undefined: no such bottle for this household). */
    now?: { inCellar: boolean; spot: SmartSpot | null };
    adviceBottle?: AdviceBottleRow;
    adviceOccupants?: AdviceOccupant[];
    /** What the database says about depth (0054); undefined: it cannot say. */
    depthStatus?: DepthDatabaseStatus | null;
  } = {},
) {
  const writes: Array<{ id: string; layout: LayoutWrite; expectedRevision?: string | null }> = [];
  const moves: Array<{
    bottleId: string;
    from: SmartSpot | null;
    to: SmartSpot | null;
    v2?: boolean;
  }> = [];
  const depthAsked = { count: 0 };
  const swaps: Array<{ a: string; b: string }> = [];
  const repo: SmartCellarRepository = {
    schemaStatus: async () =>
      options.schema ?? { reads: "ready" as const, writes: "ready" as const },
    listPlaces: async (h) => (h === HOUSEHOLD.id ? places : []),
    getPlace: async (h, id) =>
      h === HOUSEHOLD.id ? (places.find((p) => p.id === id) ?? null) : null,
    placements: async () => options.placements ?? [],
    occupiedSpots: async () => options.spots ?? [],
    occupants: async () => options.occupants ?? [],
    bottleSpot: async (h) => (h === HOUSEHOLD.id ? (options.now ?? null) : null),
    adviceBottle: async (h, id) =>
      h === HOUSEHOLD.id && options.adviceBottle?.bottleId === id ? options.adviceBottle : null,
    adviceOccupants: async (h) => (h === HOUSEHOLD.id ? (options.adviceOccupants ?? []) : []),
    moveBottle: async (_h, bottleId, from, to) => {
      moves.push({ bottleId, from, to });
      return options.move ?? { kind: "moved", to };
    },
    depthStatus: async () => {
      depthAsked.count += 1;
      return options.depthStatus ?? null;
    },
    moveBottleV2: async (_h, bottleId, from, to) => {
      moves.push({ bottleId, from, to, v2: true });
      return options.move ?? { kind: "moved", to };
    },
    swapBottles: async (_h, a, b) => {
      swaps.push({ a: a.bottleId, b: b.bottleId });
      return options.swap ?? "swapped";
    },
    saveLayout: async (_h, id, layout, expectedRevision) => {
      writes.push({ id, layout, expectedRevision: expectedRevision ?? null });
      const outcome = options.outcome ?? "saved";
      if (outcome === "saved") {
        const p = places.find((x) => x.id === id)!;
        Object.assign(p, {
          kind: layout.kind,
          template: layout.template,
          semantics: layout.semantics,
          rows: layout.rows,
          cols: layout.cols,
          cellCapacity: layout.cellCapacity,
          appearance: layout.appearance,
          zones: layout.zones,
        });
      }
      return outcome;
    },
  };
  return { repo, writes, moves, swaps, depthAsked };
}

const service = (repo: SmartCellarRepository, access = OPEN) =>
  createSmartCellarService({ repo, household: async () => HOUSEHOLD, access });

const fails = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error))
      return { code: error.code, message: error.message, retryable: error.retryable };
    throw error;
  }
  throw new Error("did not fail");
};

const config = (
  id: (typeof STORAGE_TEMPLATE_IDS)[number],
  over: Partial<StorageConfig["structure"]> = {},
): StorageConfig => ({
  structure: { ...defaultStructure(id), ...over },
  appearance: defaultAppearance(id),
});

describe("reading: a stored place in the new terms", () => {
  it("a place from before templates is exactly what it was", () => {
    const view = toUnitView(place({ kind: "fridge", rows: 6, cols: 4, occupied: 5 }));
    expect(view).toMatchObject({
      templateId: null,
      layoutTemplateId: "cooler_single",
      rows: 6,
      cols: 4,
      cellCapacity: 1,
      slotSemantics: null,
      indexMeaning: "single",
      capacity: 24,
      occupied: 5,
      free: 19,
      legacy: true,
      arrangementKnown: true,
      fallbacks: [],
      zones: [],
    });
    expect(view.appearance.v).toBe(1);
  });

  it("every template, stored as itself: known, its own family, nothing replaced", () => {
    for (const id of STORAGE_TEMPLATE_IDS) {
      const t = STORAGE_TEMPLATES[id];
      const s = defaultStructure(id);
      const view = toUnitView(
        place({
          kind: t.kind,
          template: id,
          rows: s.rows,
          cols: s.cols,
          cellCapacity: s.cellCapacity,
          semantics: t.semantics,
          appearance: defaultAppearance(id),
          zones: s.zones,
        }),
      );
      expect(view.templateId, id).toBe(id);
      expect(view.layoutTemplateId, id).toBe(id);
      expect(view.family, id).toBe(t.family);
      expect(view.arrangementKnown, id).toBe(true);
      expect(view.legacy, id).toBe(false);
      expect(view.fallbacks, id).toEqual([]);
      expect(view.capacity, id).toBe(s.rows * s.cols * s.cellCapacity);
      expect(view.zones, id).toEqual(s.zones);
      expect(view.indexMeaning, id).toBe(s.cellCapacity > 1 ? t.semantics : "single");
    }
  });

  it("a template this server does not know: returned as stored, said to be unknown, never drawn as something else", () => {
    const view = toUnitView(
      place({ template: "hex_rack_2031", semantics: "depth", cellCapacity: 1, rows: 3, cols: 4 }),
    );
    expect(view.templateId).toBe("hex_rack_2031");
    expect(view.layoutTemplateId).toBe("rack_classic"); // a stand-in, and said to be one:
    expect(view.arrangementKnown).toBe(false);
    expect(view.fallbacks).toContain("unknown_template");
    expect(view.indexMeaning).toBe("single");
    expect(view.rows * view.cols).toBe(12);
  });

  it("invalid stored meaning of the index, an invalid look, zones that do not add up: reported, not hidden", () => {
    const view = toUnitView(
      place({
        kind: "fridge",
        template: "cooler_dual",
        semantics: "ordinal", // the cooler's own is depth
        rows: 8,
        cols: 4,
        appearance: { v: 9, material: "unobtainium" },
        zones: [
          { fromRow: 1, toRow: 3, purpose: "storage", targetTempC: 12 },
          { fromRow: 5, toRow: 8, purpose: "serving", targetTempC: 7 }, // a gap at shelf 4
        ],
      }),
    );
    expect(view.slotSemantics).toBe("ordinal");
    expect(view.arrangementKnown).toBe(false);
    expect(view.fallbacks).toEqual(
      expect.arrayContaining(["semantics_mismatch", "appearance", "zones"]),
    );
    expect(view.zones).toEqual([]);
    expect(view.appearance).toEqual(defaultAppearance("cooler_dual"));
  });

  it("the server's reading and a client's reading of the same view agree (nothing pre-chewed)", () => {
    for (const row of [
      place(),
      place({ template: "rack_classic", semantics: "depth" }),
      place({ template: "hex_rack_2031", semantics: "depth" }),
      place({ kind: "wall", template: "rack_double_depth", semantics: "depth" }),
    ]) {
      const view = toUnitView(row);
      const again = resolveStorage({
        kind: view.kind,
        rows: view.rows,
        cols: view.cols,
        template: view.templateId,
        cellCapacity: view.cellCapacity,
        semantics: view.slotSemantics,
        zones: view.zones,
        appearance: view.appearance,
      });
      expect(again.arrangementKnown).toBe(view.arrangementKnown);
      expect(again.legacy).toBe(view.legacy);
      expect(again.template.id).toBe(view.layoutTemplateId);
    }
  });

  it("capacity and occupancy come from what is stored, never from a template's limits", () => {
    // a classic rack stored at 30 x 30 (the template allows it); 900 positions, 899 free
    const view = toUnitView(
      place({ template: "rack_classic", semantics: "depth", rows: 30, cols: 30, occupied: 1 }),
    );
    expect(view).toMatchObject({ capacity: 900, occupied: 1, free: 899 });
    // more bottles than capacity can only be a database out of step: free is never negative
    expect(toUnitView(place({ rows: 1, cols: 1, occupied: 3 })).free).toBe(0);
  });
});

describe("reading: rows of the database", () => {
  it("a place row and its zone rows, zones in order whatever order they came in", () => {
    const row = toStoredPlace(
      {
        id: "p",
        label: "Cooler",
        kind: "fridge",
        grid_rows: 8,
        grid_cols: 4,
        template: "cooler_dual",
        cell_capacity: 1,
        slot_semantics: "depth",
        appearance: { v: 1 },
        updated_at: "2026-11-19 08:00:00+00",
      },
      [
        {
          location_id: "p",
          zone_index: 2,
          from_row: 5,
          to_row: 8,
          purpose: "serving",
          target_temp_c: "7.5",
        },
        {
          location_id: "p",
          zone_index: 1,
          from_row: 1,
          to_row: 4,
          purpose: "storage",
          target_temp_c: 12,
        },
      ],
      3,
    );
    expect(row.zones).toEqual([
      { fromRow: 1, toRow: 4, purpose: "storage", targetTempC: 12 },
      { fromRow: 5, toRow: 8, purpose: "serving", targetTempC: 7.5 },
    ]);
    expect(row).toMatchObject({
      template: "cooler_dual",
      semantics: "depth",
      cellCapacity: 1,
      occupied: 3,
    });
  });

  it("a bottle keeps its whole spot: index 1 for a bottle from before depth, and an index above 1 is never reduced", () => {
    const wine = {
      year: 2015,
      wine_id: "w",
      wines: { name: "Pavillon", wine_type: "red", producers: { name: "Margaux" } },
    };
    const base = {
      id: "b",
      location_id: "p",
      loc_row: 2,
      loc_col: 3,
      vintage_id: "v",
      wine_vintages: wine,
    };
    expect(toPlacement({ ...base, loc_index: 1 })).toMatchObject({ row: 2, col: 3, index: 1 });
    expect(toPlacement({ ...base, loc_index: 2 })).toMatchObject({ row: 2, col: 3, index: 2 });
    expect(toPlacement({ ...base, loc_index: 16 })?.index).toBe(16);
    expect(toPlacement({ ...base, loc_index: 1 })).toMatchObject({
      bottleId: "b",
      locationId: "p",
      vintageId: "v",
      wineId: "w",
      producer: "Margaux",
      wineName: "Pavillon",
      year: 2015,
      type: "red",
    });
    // where the wine is from and the bottle's own label photo travel with it; a photo that cannot be read is none
    const photographed = {
      ...base,
      loc_index: 1,
      front_image_id: "img-1",
      wine_vintages: { ...wine, wines: { ...wine.wines, region: "Bordeaux", country_code: "FR" } },
    };
    const ref = { id: "img-1", blurColor: "#553322", width: 900, height: 1200, texture: true };
    expect(toPlacement(photographed, new Map([["img-1", ref]]))).toMatchObject({
      region: "Bordeaux",
      countryCode: "FR",
      image: ref,
    });
    expect(toPlacement(photographed, new Map())?.image).toBeNull();
    expect(toPlacement({ ...base, loc_index: 1 })).toMatchObject({
      region: null,
      countryCode: null,
      image: null,
    });
    // no place: not a placement (the database keeps location, row and column together)
    expect(
      toPlacement({ ...base, location_id: null, loc_row: null, loc_col: null, loc_index: 1 }),
    ).toBeNull();
  });

  it("zones go to save_storage_layout under its own names, top first", () => {
    expect(
      zonesForRpc([
        { fromRow: 1, toRow: 4, purpose: "storage", targetTempC: 12 },
        { fromRow: 5, toRow: 8, purpose: "serving", targetTempC: null },
      ]),
    ).toEqual([
      { from_row: 1, to_row: 4, purpose: "storage", target_temp_c: 12 },
      { from_row: 5, to_row: 8, purpose: "serving", target_temp_c: null },
    ]);
  });
});

describe("a database without the Smart Cellar step", () => {
  it("only 'no such column', 'no such table' and 'no such function' mean that", () => {
    for (const code of ["42703", "PGRST204", "42P01", "PGRST205", "PGRST200", "PGRST202"])
      expect(isSchemaMissing({ code }), code).toBe(true);
    for (const code of ["42501", "PGRST301", "57014", "08006", "23514", "P0001", "", undefined])
      expect(isSchemaMissing({ code }), String(code)).toBe(false);
  });

  it("is told plainly; a permission error stays a permission error; a network failure stays a failure", () => {
    expect(mapSmartCellarError({ code: "42703" })).toMatchObject({ code: "NOT_FOUND" });
    expect(mapSmartCellarError({ code: "42703" }).message).toMatch(/isn't set up/);
    expect(mapSmartCellarError({ code: "42501" }).code).toBe("FORBIDDEN");
    expect(mapSmartCellarError({ code: "08006", message: "connection lost" }).code).toBe(
      "INTERNAL",
    );
  });

  it("writers that ran into each other: nothing changed, try again", () => {
    for (const code of ["40P01", "40001", "55P03"]) {
      const e = mapSmartCellarError({ code, message: code === "55P03" ? "zone_place_busy" : "x" });
      expect(e.code, code).toBe("CONFLICT");
      expect(e.retryable, code).toBe(true);
    }
  });

  it("the capabilities say so, and reading says so", async () => {
    for (const schema of [
      { reads: "missing", writes: "missing" },
      { reads: "ready", writes: "missing" },
      { reads: "ready", writes: "unverified" },
    ] as const) {
      const { repo } = fakeRepo([], { schema });
      expect((await service(repo).capabilities()).schema).toEqual(schema);
    }
    const ready = fakeRepo([]);
    expect(await service(ready.repo).capabilities()).toMatchObject({
      version: 1,
      reads: true,
      writes: true,
      depthPlacement: false,
      schema: { reads: "ready", writes: "ready" },
      exportVersions: [1, 2],
    });
  });
});

describe("the switch", () => {
  it("closed: every call is 'not found', as if there were no such API", async () => {
    const { repo, writes } = fakeRepo([place()]);
    const closed = service(repo, { reads: false, writes: false });
    for (const call of [
      () => closed.capabilities(),
      () => closed.units(),
      () => closed.unit("p-1"),
      () => closed.placements("p-1"),
      () => closed.saveLayout("p-1", config("rack_classic")),
    ])
      expect((await fails(call())).code).toBe("NOT_FOUND");
    expect(() => closed.guardWrites()).toThrow();
    expect(writes).toEqual([]);
  });

  it("reading only: reads answer, a layout is refused before anything is looked at", async () => {
    const { repo, writes } = fakeRepo([place()]);
    const reading = service(repo, { reads: true, writes: false });
    expect(await reading.units()).toHaveLength(1);
    expect((await fails(reading.saveLayout("p-1", config("rack_classic")))).code).toBe("FORBIDDEN");
    expect(writes).toEqual([]);
  });
});

describe("saving a layout", () => {
  it("a valid one-deep layout: one call, the template decides the kind and the meaning of the index", async () => {
    const p = place({ kind: "other", rows: 3, cols: 3 });
    const { repo, writes } = fakeRepo([p]);
    const saved = await service(repo).saveLayout(
      "p-1",
      config("cooler_dual", {
        rows: 8,
        cols: 4,
        zones: [
          { fromRow: 1, toRow: 4, purpose: "storage", targetTempC: 12 },
          { fromRow: 5, toRow: 8, purpose: "serving", targetTempC: 7.5 },
        ],
      }),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]!.layout).toMatchObject({
      kind: "fridge",
      template: "cooler_dual",
      semantics: "depth",
      rows: 8,
      cols: 4,
      cellCapacity: 1,
    });
    expect(saved).toMatchObject({
      templateId: "cooler_dual",
      arrangementKnown: true,
      legacy: false,
      fallbacks: [],
    });
    expect(saved.zones).toHaveLength(2);
  });

  it("more than one bottle per position is refused before the database is asked", async () => {
    const { repo, writes } = fakeRepo([place()]);
    for (const c of [config("rack_double_depth", { cellCapacity: 2 }), config("diamond_bins")]) {
      const e = await fails(service(repo).saveLayout("p-1", c));
      expect(e.code).toBe("CONFLICT");
      expect(e.message).toMatch(/isn't switched on/);
    }
    expect(writes).toEqual([]);
  });

  it("a layout that would take a bottle's spot is refused, and nothing is written", async () => {
    const { repo, writes } = fakeRepo([place()], { spots: [{ row: 5, col: 8, index: 1 }] });
    const e = await fails(
      service(repo).saveLayout("p-1", config("rack_classic", { rows: 4, cols: 8 })),
    );
    expect(e.code).toBe("CONFLICT");
    expect(writes).toEqual([]);
  });

  it("a draft made against an older revision is refused, and nothing is written (sprint 3)", async () => {
    const { repo, writes } = fakeRepo([place({ revision: "r2" })]);
    const e = await fails(service(repo).saveLayout("p-1", config("rack_classic"), "r1"));
    expect(e.code).toBe("CONFLICT");
    expect(e.message).toBe(STALE_LAYOUT_MESSAGE);
    expect(writes).toEqual([]);
    // the current revision, or none at all (an older client): saved
    await service(repo).saveLayout("p-1", config("rack_classic"), "r2");
    await service(repo).saveLayout("p-1", config("rack_classic"), null);
    expect(writes).toHaveLength(2);
  });

  it("the revision is handed to the database's own compare-and-swap, unchanged to the microsecond (0051)", async () => {
    const revision = "2026-11-29T10:00:00.123456+00:00";
    const { repo, writes } = fakeRepo([place({ revision })]);
    await service(repo).saveLayout("p-1", config("rack_classic"), revision);
    // none at all (an older client, or a basic place just made): no comparison, as before
    await service(repo).saveLayout("p-1", config("rack_classic"), null);
    await service(repo).saveLayout("p-1", config("rack_classic"));
    expect(writes.map((w) => w.expectedRevision)).toEqual([revision, null, null]);
  });

  it("a revision that differs from the place's only below the millisecond is still another revision", async () => {
    const { repo, writes } = fakeRepo([place({ revision: "2026-11-29T10:00:00.123456+00:00" })]);
    const e = await fails(
      service(repo).saveLayout("p-1", config("rack_classic"), "2026-11-29T10:00:00.123+00:00"),
    );
    expect(e.message).toBe(STALE_LAYOUT_MESSAGE);
    expect(writes).toEqual([]);
  });

  it("the database's 'stale' (a save that landed after the app's own check) is the same 409", async () => {
    const p = place({ revision: "r1" });
    const { repo, writes } = fakeRepo([p], { outcome: "stale" });
    const e = await fails(service(repo).saveLayout("p-1", config("rack_classic"), "r1"));
    expect(e.code).toBe("CONFLICT");
    expect(e.message).toBe(STALE_LAYOUT_MESSAGE);
    expect(writes).toHaveLength(1);
    expect(p.template).toBeNull();
  });

  it("the place's revision is part of what is read", () => {
    expect(toUnitView(place({ revision: "2026-11-19 09:00:00+00" })).revision).toBe(
      "2026-11-19 09:00:00+00",
    );
  });

  it("what the database refuses is passed on as the same refusals", async () => {
    const cases: Array<[SaveLayoutOutcome, string]> = [
      ["in_use", "CONFLICT"],
      ["semantics_change", "CONFLICT"],
      ["invalid_zones", "VALIDATION"],
      ["depth_not_enabled", "CONFLICT"],
      ["not_found", "NOT_FOUND"],
    ];
    for (const [outcome, code] of cases) {
      const p = place();
      const { repo } = fakeRepo([p], { outcome });
      expect(
        (await fails(service(repo).saveLayout("p-1", config("rack_classic")))).code,
        outcome,
      ).toBe(code);
      // nothing about the place changed
      expect(p.template).toBeNull();
    }
  });

  it("another household's place, or none at all: not found, and nothing is written", async () => {
    const { repo, writes } = fakeRepo([place()]);
    const other = createSmartCellarService({
      repo,
      household: async () => ({ id: "h-2", currency: "EUR" }),
      access: OPEN,
    });
    expect((await fails(other.saveLayout("p-1", config("rack_classic")))).code).toBe("NOT_FOUND");
    expect((await fails(other.unit("p-1"))).code).toBe("NOT_FOUND");
    expect((await fails(service(repo).saveLayout("nope", config("rack_classic")))).code).toBe(
      "NOT_FOUND",
    );
    expect(writes).toEqual([]);
  });
});

// ---- Placement (sprint 4) ------------------------------------------------------------------------------------------

describe("moving and swapping bottles", () => {
  const PLACE_ON = { open: true, canWrite: true, depth: false };
  const placementService = (repo: SmartCellarRepository, placement = PLACE_ON, access = OPEN) =>
    createSmartCellarService({ repo, household: async () => HOUSEHOLD, access, placement });
  const spot = (locationId: string, row: number, col: number, index = 1): SmartSpot => ({
    locationId,
    row,
    col,
    index,
  });
  const P = "p-1";

  it("closed: not found, open without writes: forbidden; nothing is written either way", async () => {
    const { repo, moves } = fakeRepo([place()]);
    const closed = createSmartCellarService({
      repo,
      household: async () => HOUSEHOLD,
      access: OPEN,
    });
    expect((await fails(closed.moveBottle("b", { from: null, to: spot(P, 1, 1) }))).code).toBe(
      "NOT_FOUND",
    );
    const readOnly = placementService(repo, { open: true, canWrite: false, depth: false });
    expect((await fails(readOnly.moveBottle("b", { from: null, to: spot(P, 1, 1) }))).code).toBe(
      "FORBIDDEN",
    );
    // the API not writing closes it too, whatever the placement gate says
    const apiReadOnly = placementService(repo, PLACE_ON, { reads: true, writes: false });
    expect(
      (
        await fails(
          apiReadOnly.swapBottle("b", {
            with: "c",
            expected: { self: spot(P, 1, 1), other: spot(P, 1, 2) },
          }),
        )
      ).code,
    ).toBe("FORBIDDEN");
    expect(moves).toEqual([]);
  });

  it("an unplaced bottle onto a free spot: one conditional move, from and to whole", async () => {
    const { repo, moves } = fakeRepo([place()], {
      occupants: [{ bottleId: "x", row: 1, col: 1, index: 1 }],
    });
    const result = await placementService(repo).moveBottle("b", { from: null, to: spot(P, 1, 2) });
    expect(result).toEqual({ bottleId: "b", outcome: "moved", from: null, to: spot(P, 1, 2) });
    expect(moves).toEqual([{ bottleId: "b", from: null, to: spot(P, 1, 2) }]);
  });

  it("refused before the database is asked: taken, past the cell, out of the place, unknown arrangement, no such place", async () => {
    const { repo, moves } = fakeRepo(
      [place(), place({ id: "odd", template: "hex_rack_2031", semantics: "depth" })],
      { occupants: [{ bottleId: "x", row: 1, col: 1, index: 1 }] },
    );
    const s = placementService(repo);
    const cases: Array<[SmartSpot, string, string]> = [
      [spot(P, 1, 1), "CONFLICT", "That spot was just taken. Pick another."],
      // a second bottle in a one-bottle cell: that spot doesn't exist here (depth is refused separately)
      [spot(P, 1, 2, 2), "VALIDATION", "That spot doesn't exist in this place."],
      [spot(P, 9, 1), "VALIDATION", "That spot doesn't exist in this place."],
      [
        spot("odd", 1, 1),
        "CONFLICT",
        "CELLR doesn't know how that place is arranged, so it can't put a bottle there.",
      ],
      [spot("nope", 1, 1), "NOT_FOUND", "We couldn't find that place."],
    ];
    for (const [to, code, message] of cases) {
      const e = await fails(s.moveBottle("b", { from: null, to }));
      expect([e.code, e.message], JSON.stringify(to)).toEqual([code, message]);
    }
    expect(moves).toEqual([]);
  });

  it("what the database answers, said as what it is", async () => {
    const cases: Array<[MoveOutcome, string]> = [
      [{ kind: "stale", now: null }, "CONFLICT"],
      [{ kind: "taken" }, "CONFLICT"],
      [{ kind: "out_of_bounds" }, "VALIDATION"],
      [{ kind: "ambiguous" }, "CONFLICT"],
      [{ kind: "gone" }, "CONFLICT"],
      [{ kind: "not_found" }, "NOT_FOUND"],
    ];
    for (const [move, code] of cases) {
      const { repo } = fakeRepo([place()], { move });
      expect(
        (
          await fails(
            placementService(repo).moveBottle("b", { from: spot(P, 2, 2), to: spot(P, 1, 2) }),
          )
        ).code,
        move.kind,
      ).toBe(code);
    }
    // a taken target may be tried again with another spot
    const { repo } = fakeRepo([place()], { move: { kind: "taken" } });
    expect(
      (await fails(placementService(repo).moveBottle("b", { from: null, to: spot(P, 1, 2) })))
        .retryable,
    ).toBe(true);
  });

  it("a repeat of a move that already happened answers already there, and changes nothing", async () => {
    const { repo } = fakeRepo([place()], { move: { kind: "already_there" } });
    expect(
      (await placementService(repo).moveBottle("b", { from: spot(P, 2, 2), to: spot(P, 1, 2) }))
        .outcome,
    ).toBe("already_there");
    // from and to the same spot: still the database's answer (it knows whether the bottle is really there), never
    // a 200 decided without it
    const same = fakeRepo([place()], {
      occupants: [{ bottleId: "b", row: 1, col: 2, index: 1 }],
      move: { kind: "already_there" },
    });
    const answer = await placementService(same.repo).moveBottle("b", {
      from: spot(P, 1, 2),
      to: spot(P, 1, 2),
    });
    expect(answer.outcome).toBe("already_there");
    expect(same.moves).toHaveLength(1);
    const nowhere = fakeRepo([place()], { move: { kind: "not_found" } });
    expect(
      (await fails(placementService(nowhere.repo).moveBottle("x", { from: null, to: null }))).code,
    ).toBe("NOT_FOUND");
    expect(nowhere.moves).toHaveLength(1);
  });

  it("depth stays off whatever chooses the index: a filled compartment's next counter, or the caller", async () => {
    const bins = place({
      template: "diamond_bins",
      semantics: "ordinal",
      cellCapacity: 8,
      rows: 2,
      cols: 3,
    });
    const { repo, moves } = fakeRepo([bins], {
      occupants: [{ bottleId: "x", row: 1, col: 1, index: 1 }],
    });
    // the compartment holds one: the next counter would be 2
    const refused = await fails(
      placementService(repo).moveBottle("b", { from: null, to: spot(P, 1, 1) }),
    );
    expect([refused.code, refused.message]).toEqual([
      "CONFLICT",
      "More than one bottle per position isn't switched on yet.",
    ]);
    // an empty compartment: counter 1, fine
    expect(
      (await placementService(repo).moveBottle("b", { from: null, to: spot(P, 2, 3) })).to?.index,
    ).toBe(1);
    expect(moves.map((m) => m.to?.index)).toEqual([1]);
    // past a single-spot cell: the spot doesn't exist (422), not "depth"
    const single = fakeRepo([place()]);
    expect(
      (
        await fails(
          placementService(single.repo).moveBottle("b", { from: null, to: spot(P, 1, 1, 5) }),
        )
      ).code,
    ).toBe("VALIDATION");
    expect(single.moves).toEqual([]);
  });

  it("taking a bottle off its place, and moving between places", async () => {
    const { repo, moves } = fakeRepo([place(), place({ id: "p-2" })]);
    expect(
      (await placementService(repo).moveBottle("b", { from: spot(P, 1, 1), to: null })).to,
    ).toBeNull();
    await placementService(repo).moveBottle("b", { from: spot(P, 1, 1), to: spot("p-2", 3, 3) });
    expect(moves.map((m) => m.to?.locationId ?? null)).toEqual([null, "p-2"]);
  });

  it("where a bottle is now: read as it is (placed, without a place, gone); closed and unknown are not found", async () => {
    const spotted = fakeRepo([place()], { now: { inCellar: true, spot: spot(P, 2, 3) } });
    expect(await placementService(spotted.repo).bottleSpot("b")).toEqual({
      bottleId: "b",
      inCellar: true,
      spot: spot(P, 2, 3),
    });
    const loose = fakeRepo([place()], { now: { inCellar: true, spot: null } });
    expect((await placementService(loose.repo).bottleSpot("b")).spot).toBeNull();
    const gone = fakeRepo([place()], { now: { inCellar: false, spot: null } });
    expect((await placementService(gone.repo).bottleSpot("b")).inCellar).toBe(false);
    // read-only placement still reads; a closed gate, or no such bottle here, is "not found"
    expect(
      (
        await placementService(spotted.repo, {
          open: true,
          canWrite: false,
          depth: false,
        }).bottleSpot("b")
      ).spot,
    ).toEqual(spot(P, 2, 3));
    const closed = createSmartCellarService({
      repo: spotted.repo,
      household: async () => HOUSEHOLD,
      access: OPEN,
    });
    expect((await fails(closed.bottleSpot("b"))).code).toBe("NOT_FOUND");
    expect((await fails(placementService(fakeRepo([place()]).repo).bottleSpot("x"))).code).toBe(
      "NOT_FOUND",
    );
  });

  it("swaps: full spots both ways; refused for the same bottle, inside one compartment, unknown places and depth", async () => {
    const { repo, swaps } = fakeRepo([
      place(),
      place({ id: "odd", template: "hex_rack_2031", semantics: "depth" }),
    ]);
    const s = placementService(repo);
    const ok = await s.swapBottle("a", {
      with: "b",
      expected: { self: spot(P, 1, 1), other: spot(P, 2, 2) },
    });
    expect(ok).toEqual({
      self: { bottleId: "a", spot: spot(P, 2, 2) },
      other: { bottleId: "b", spot: spot(P, 1, 1) },
    });
    expect(swaps).toEqual([{ a: "a", b: "b" }]);
    const refused: Array<[Parameters<typeof s.swapBottle>, string]> = [
      [["a", { with: "a", expected: { self: spot(P, 1, 1), other: spot(P, 2, 2) } }], "VALIDATION"],
      [
        ["a", { with: "b", expected: { self: spot("odd", 1, 1), other: spot(P, 2, 2) } }],
        "CONFLICT",
      ],
      [
        ["a", { with: "b", expected: { self: spot(P, 1, 1, 2), other: spot(P, 2, 2) } }],
        "CONFLICT",
      ],
    ];
    for (const [args, code] of refused)
      expect((await fails(s.swapBottle(...args))).code).toBe(code);
    expect(swaps).toHaveLength(1);
    for (const [outcome, code] of [
      ["stale", "CONFLICT"],
      ["gone", "CONFLICT"],
      ["invalid", "VALIDATION"],
      ["not_found", "NOT_FOUND"],
    ] as const) {
      const r = fakeRepo([place()], { swap: outcome });
      expect(
        (
          await fails(
            placementService(r.repo).swapBottle("a", {
              with: "b",
              expected: { self: spot(P, 1, 1), other: spot(P, 2, 2) },
            }),
          )
        ).code,
      ).toBe(code);
    }
  });
});

describe("placement advice (sprint 5)", () => {
  const PLACE_ON = { open: true, canWrite: true, depth: false };
  const BOTTLE: AdviceBottleRow = {
    bottleId: "b",
    inCellar: true,
    spot: null,
    vintageId: "v1",
    wineId: "w1",
    producerId: "p1",
    type: "red",
    year: 2015,
  };
  const svc = (
    repo: SmartCellarRepository,
    { placement = PLACE_ON, access = OPEN, advice = true } = {},
  ) =>
    createSmartCellarService({
      repo,
      household: async () => HOUSEHOLD,
      access,
      placement,
      advice,
    });

  it("closed unless both the advice gate and placement are open: not found, nothing read", async () => {
    const { repo } = fakeRepo([place()], { adviceBottle: BOTTLE });
    expect((await fails(svc(repo, { advice: false }).advise("b", "store"))).code).toBe("NOT_FOUND");
    expect(
      (await fails(svc(repo, { placement: PLACEMENT_CLOSED }).advise("b", "store"))).code,
    ).toBe("NOT_FOUND");
  });

  it("advises from the repository's facts only, and says whether placing is possible here", async () => {
    const { repo } = fakeRepo([place()], {
      adviceBottle: BOTTLE,
      adviceOccupants: [
        {
          bottleId: "twin",
          locationId: "p-1",
          row: 2,
          col: 2,
          index: 1,
          vintageId: "v1",
          wineId: "w1",
          producerId: "p1",
          type: "red",
        },
      ],
    });
    const view = await svc(repo).advise("b", "store");
    expect(view.status).toBe("ok");
    expect(view.canPlace).toBe(true);
    expect(view.recommendations[0]!.reasons).toContainEqual({
      code: "group",
      tier: "vintage",
      proximity: "neighbour",
      count: 1,
    });
    // a known year doesn't prove a drinking window or its source: no window caveat from the API
    expect(view.caveats.map((c) => c.code)).not.toContain("estimated_window_not_used");
    // read-only placement: advice still reads, acting on it is not possible here
    const readOnly = await svc(repo, {
      placement: { open: true, canWrite: false, depth: false },
    }).advise("b", "store");
    expect(readOnly.canPlace).toBe(false);
    const apiReadOnly = await svc(repo, { access: { reads: true, writes: false } }).advise(
      "b",
      "serve",
    );
    expect(apiReadOnly.canPlace).toBe(false);
  });

  it("a database without the Smart Cellar step: said as 'not set up', never as an empty cellar or a closed gate", async () => {
    const { repo } = fakeRepo([place()], { adviceBottle: BOTTLE });
    const missing = {
      ...repo,
      listPlaces: async () => {
        throw mapSmartCellarError({ code: "42703", message: 'column "template" does not exist' });
      },
    };
    const e = await fails(svc(missing).advise("b", "store"));
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toBe(SMART_CELLAR_NOT_SET_UP);
    // a closed gate says nothing of the kind
    expect((await fails(svc(repo, { advice: false }).advise("b", "store"))).message).not.toBe(
      SMART_CELLAR_NOT_SET_UP,
    );
  });

  it("no drinking-window provenance is ever invented: vintage, non-vintage or incomplete catalogue rows", async () => {
    for (const bottle of [
      BOTTLE,
      { ...BOTTLE, year: null },
      { ...BOTTLE, wineId: null, producerId: null, type: null, year: null },
    ]) {
      const { repo } = fakeRepo([place()], { adviceBottle: bottle });
      const view = await svc(repo).advise("b", "store");
      expect(
        view.caveats.map((c) => c.code),
        JSON.stringify(bottle),
      ).not.toContain("estimated_window_not_used");
    }
    // the unknown year is still said where it is a fact
    const { repo } = fakeRepo([place()], { adviceBottle: { ...BOTTLE, year: null } });
    expect((await svc(repo).advise("b", "store")).caveats).toContainEqual({
      code: "vintage_unknown",
    });
  });

  it("another household's bottle, or none: not found", async () => {
    const { repo } = fakeRepo([place()], { adviceBottle: BOTTLE });
    expect((await fails(svc(repo).advise("someone-else", "store"))).code).toBe("NOT_FOUND");
  });
});

// ---- Depth as a server-decided capability (sprint 9) ----------------------------------------------------------------

describe("depth: offered only where the gate is open AND the database says so (ADR-011 §5)", () => {
  const PLACE_ON = { open: true, canWrite: true, depth: false };
  const ON: DepthDatabaseStatus = {
    depthPlacement: true,
    legacyCellIndex: false,
    indexUnique: true,
    moveV2: true,
  };
  const PRODUCTION_TODAY: DepthDatabaseStatus = {
    ...ON,
    depthPlacement: false,
    legacyCellIndex: true,
  };
  const D = "p-d";
  // a fresh place per use: a saved layout is written into the fake's place
  const deepPlace = () =>
    place({
      id: D,
      template: "rack_double_depth",
      semantics: "depth",
      cellCapacity: 2,
      rows: 4,
      cols: 6,
    });
  const at = (row: number, col: number, index = 1): SmartSpot => ({
    locationId: D,
    row,
    col,
    index,
  });
  const svc = (repo: SmartCellarRepository, depthGate: boolean, placement = PLACE_ON) =>
    createSmartCellarService({
      repo,
      household: async () => HOUSEHOLD,
      access: OPEN,
      placement,
      depthGate,
    });

  it("gate closed (the default, production): the database is never asked, and the capabilities are as before", async () => {
    const { repo, depthAsked, moves } = fakeRepo([deepPlace()], { depthStatus: ON });
    const service = svc(repo, false);
    const caps = await service.capabilities();
    expect(caps.depthPlacement).toBe(false);
    expect("depth" in caps).toBe(false);
    expect(Object.keys(caps).sort()).toEqual([
      "appearanceVersion",
      "catalogVersion",
      "depthPlacement",
      "exportVersions",
      "reads",
      "schema",
      "version",
      "writes",
    ]);
    expect((await fails(service.moveBottle("b", { from: null, to: at(1, 1, 2) }))).message).toMatch(
      /isn't switched on/,
    );
    expect(
      (await fails(service.saveLayout(D, config("rack_double_depth", { cellCapacity: 2 }))))
        .message,
    ).toMatch(/isn't switched on/);
    await service.moveBottle("b", { from: null, to: at(1, 1) });
    expect(moves.every((m) => !m.v2)).toBe(true);
    expect(depthAsked.count).toBe(0);
  });

  it("gate open, database as production is today (switch off, old index): still off, and why", async () => {
    const { repo } = fakeRepo([deepPlace()], { depthStatus: PRODUCTION_TODAY });
    const caps = await svc(repo, true).capabilities();
    expect(caps.depthPlacement).toBe(false);
    expect(caps.depth).toEqual({
      gate: true,
      database: PRODUCTION_TODAY,
      open: false,
      blockedBy: "database_switch_off",
    });
  });

  it("gate open, a database that cannot say (no 0054): off", async () => {
    const { repo } = fakeRepo([deepPlace()]);
    const caps = await svc(repo, true).capabilities();
    expect(caps.depth).toMatchObject({
      open: false,
      blockedBy: "database_unknown",
      database: null,
    });
  });

  it("each missing fact keeps it off: the old index, the new index, move_bottle_v2", async () => {
    for (const [status, block] of [
      [{ ...ON, legacyCellIndex: true }, "legacy_index"],
      [{ ...ON, indexUnique: false }, "index_missing"],
      [{ ...ON, moveV2: false }, "move_missing"],
    ] as const) {
      const { repo } = fakeRepo([deepPlace()], { depthStatus: status });
      expect((await svc(repo, true).capabilities()).depth).toMatchObject({
        open: false,
        blockedBy: block,
      });
    }
  });

  it("gate open but placement not writing here: off, though the database says on", async () => {
    const { repo } = fakeRepo([deepPlace()], { depthStatus: ON });
    const caps = await svc(repo, true, {
      open: true,
      canWrite: false,
      depth: false,
    }).capabilities();
    expect(caps.depthPlacement).toBe(false);
    expect(caps.depth).toMatchObject({ open: false, blockedBy: null });
  });

  it("all open: depth is offered, the database asked once per request", async () => {
    const { repo, depthAsked } = fakeRepo([deepPlace()], { depthStatus: ON });
    const service = svc(repo, true);
    const caps = await service.capabilities();
    expect(caps.depthPlacement).toBe(true);
    expect(caps.depth).toMatchObject({ open: true, blockedBy: null });
    await service.capabilities();
    expect(depthAsked.count).toBe(1);
  });

  it("all open: a deep layout is saved (two per spot), bins too", async () => {
    const { repo, writes } = fakeRepo([deepPlace()], { depthStatus: ON });
    await svc(repo, true).saveLayout(
      D,
      config("rack_double_depth", { cellCapacity: 2, rows: 4, cols: 6 }),
    );
    expect(writes[0]!.layout).toMatchObject({
      template: "rack_double_depth",
      cellCapacity: 2,
      semantics: "depth",
    });
    await svc(repo, true).saveLayout(D, config("diamond_bins"));
    expect(writes[1]!.layout).toMatchObject({ template: "diamond_bins", semantics: "ordinal" });
  });

  it("all open: a move to the back of a free cell goes through move_bottle_v2", async () => {
    const { repo, moves } = fakeRepo([deepPlace()], { depthStatus: ON });
    const result = await svc(repo, true).moveBottle("b", { from: null, to: at(2, 2, 2) });
    expect(result).toMatchObject({ outcome: "moved", to: at(2, 2, 2) });
    expect(moves).toEqual([{ bottleId: "b", from: null, to: at(2, 2, 2), v2: true }]);
  });

  it("all open: behind a taken front is not a target; a bottle behind a front is not reachable", async () => {
    const occupants = [
      { bottleId: "front", row: 1, col: 1, index: 1 },
      { bottleId: "back", row: 1, col: 1, index: 2 },
      { bottleId: "lone", row: 3, col: 3, index: 2 },
      { bottleId: "f2", row: 2, col: 2, index: 1 },
    ];
    const { repo, moves, swaps } = fakeRepo([deepPlace()], { depthStatus: ON, occupants });
    const service = svc(repo, true);
    expect((await fails(service.moveBottle("b", { from: null, to: at(2, 2, 2) }))).message).toBe(
      "Another bottle is in front of that spot.",
    );
    expect(
      (await fails(service.moveBottle("back", { from: at(1, 1, 2), to: at(2, 1) }))).message,
    ).toBe("Another bottle is in front of this one. Move that one first.");
    expect((await fails(service.moveBottle("back", { from: at(1, 1, 2), to: null }))).message).toBe(
      "Another bottle is in front of this one. Move that one first.",
    );
    // a lone back bottle is reachable, and the front one always
    await service.moveBottle("lone", { from: at(3, 3, 2), to: at(4, 4, 2) });
    await service.moveBottle("front", { from: at(1, 1), to: at(2, 1) });
    expect(moves.map((m) => m.bottleId)).toEqual(["lone", "front"]);
    // swaps: the back bottle with anything but its own front is refused; front and back of one cell trade
    expect(
      (
        await fails(
          service.swapBottle("back", {
            with: "lone",
            expected: { self: at(1, 1, 2), other: at(3, 3, 2) },
          }),
        )
      ).message,
    ).toBe("Another bottle is in front of this one. Move that one first.");
    await service.swapBottle("back", {
      with: "front",
      expected: { self: at(1, 1, 2), other: at(1, 1, 1) },
    });
    expect(swaps).toEqual([{ a: "back", b: "front" }]);
  });

  it("depth open does not change a one-deep place: a move there is the same conditional move as before", async () => {
    const legacy = place({ id: "p-1" });
    const { repo, moves } = fakeRepo([legacy, deepPlace()], { depthStatus: ON });
    await svc(repo, true).moveBottle("b", {
      from: null,
      to: { locationId: "p-1", row: 1, col: 1, index: 1 },
    });
    // through move_bottle_v2 (the same outcome for index 1), never past what the place holds
    expect(moves).toHaveLength(1);
    expect(
      (
        await fails(
          svc(repo, true).moveBottle("b", {
            from: null,
            to: { locationId: "p-1", row: 1, col: 1, index: 2 },
          }),
        )
      ).code,
    ).toBe("VALIDATION");
  });
});
