import { describe, expect, it } from "vitest";
import {
  STALE_LAYOUT_MESSAGE,
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
import { createSmartCellarService, toUnitView } from "./service";
import type {
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
  } = {},
) {
  const writes: Array<{ id: string; layout: LayoutWrite }> = [];
  const repo: SmartCellarRepository = {
    schemaStatus: async () =>
      options.schema ?? { reads: "ready" as const, writes: "ready" as const },
    listPlaces: async (h) => (h === HOUSEHOLD.id ? places : []),
    getPlace: async (h, id) =>
      h === HOUSEHOLD.id ? (places.find((p) => p.id === id) ?? null) : null,
    placements: async () => options.placements ?? [],
    occupiedSpots: async () => options.spots ?? [],
    saveLayout: async (_h, id, layout) => {
      writes.push({ id, layout });
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
  return { repo, writes };
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
