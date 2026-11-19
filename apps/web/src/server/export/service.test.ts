import { describe, expect, it } from "vitest";
import { defaultAppearance, exportFileName, type SmartStorageUnitView } from "@cellr/domain";
import { bottleV2, createExportService } from "./service";
import type { ExportBottleRow } from "./types";

const bottle = (over: Partial<ExportBottleRow> = {}): ExportBottleRow => ({
  producer: "Château Margaux",
  wine: "Pavillon Rouge",
  year: 2015,
  type: "red",
  country: "FR",
  region: "Bordeaux",
  appellation: "Margaux",
  status: "in_cellar",
  place: "Wine fridge",
  row: 2,
  col: 3,
  sizeMl: 750,
  priceCents: 2450,
  currency: "EUR",
  purchasedAt: "2020-05-17",
  purchasedFrom: "Wijnhandel Smit",
  notes: "Cadeau",
  addedAt: "2026-01-01T10:00:00Z",
  openedAt: null,
  ...over,
});

const deps = (over: Partial<Parameters<typeof createExportService>[0]> = {}) => ({
  repo: {
    bottles: async () => [
      bottle(),
      bottle({
        status: "opened",
        place: null,
        row: null,
        col: null,
        openedAt: "2026-03-01T12:00:00Z",
        priceCents: null,
      }),
    ],
    tastings: async () => [
      {
        producer: "Château Margaux",
        wine: "Pavillon Rouge",
        year: 2015,
        score: 9,
        descriptors: ["fruity"],
        note: "Lovely",
        tastedAt: "2026-03-01T12:00:00Z",
        by: "Joost",
      },
      {
        producer: "Château Margaux",
        wine: "Pavillon Rouge",
        year: 2015,
        score: null,
        descriptors: [],
        note: "Corked?",
        tastedAt: "2026-03-02T12:00:00Z",
        by: null,
      },
    ],
  },
  household: async () => ({ id: "h1", currency: "EUR" }),
  householdName: async () => "Joost & Merel",
  places: async () => [{ label: "Wine fridge", kind: "fridge" as const, rows: 3, cols: 4 }],
  favorites: async () => [{ producer: "Château Margaux", wine: "Pavillon Rouge" }],
  wishlist: async () => ({
    currency: "EUR",
    ready: true,
    items: [
      {
        id: "x",
        wineId: "w",
        producer: "Cascina Bella",
        wineName: "Barolo",
        type: "red" as const,
        region: null,
        countryCode: "IT",
        year: 2016,
        note: "Ask",
        maxPriceCents: 4550,
        inCellar: 0,
        addedAt: "2026-02-01T00:00:00Z",
      },
    ],
  }),
  now: () => new Date("2026-10-12T09:30:00Z"),
  ...over,
});

describe("taking your data with you", () => {
  it("writes everything in words, not ids, with prices as numbers and ratings in stars", async () => {
    const data = await createExportService(deps()).everything();
    expect(data).toMatchObject({
      app: "cellr",
      version: 1,
      exportedAt: "2026-10-12T09:30:00.000Z",
      household: { name: "Joost & Merel", currency: "EUR" },
      places: [{ name: "Wine fridge", kind: "fridge", shelves: 3, positionsPerShelf: 4 }],
      favorites: [{ producer: "Château Margaux", wine: "Pavillon Rouge" }],
    });
    expect(data.bottles).toHaveLength(2);
    expect(data.bottles[0]).toMatchObject({
      producer: "Château Margaux",
      wine: "Pavillon Rouge",
      vintage: 2015,
      status: "in_cellar",
      place: "Wine fridge",
      shelf: 2,
      position: 3,
      price: 24.5,
      currency: "EUR",
      purchasedOn: "2020-05-17",
      purchasedFrom: "Wijnhandel Smit",
      notes: "Cadeau",
    });
    // Opened bottles are part of the history too, with the day they were opened.
    expect(data.bottles[1]).toMatchObject({
      status: "opened",
      place: null,
      price: null,
      openedAt: "2026-03-01T12:00:00Z",
    });
    expect(data.tastings.map((t) => [t.stars, t.words, t.note, t.by])).toEqual([
      [4.5, ["fruity"], "Lovely", "Joost"],
      [null, [], "Corked?", null],
    ]);
    expect(data.wishlist).toEqual([
      {
        producer: "Cascina Bella",
        wine: "Barolo",
        vintage: 2016,
        note: "Ask",
        maxPrice: 45.5,
        addedAt: "2026-02-01T00:00:00Z",
      },
    ]);
  });

  it("says nothing it does not know: no ids, no internal columns", async () => {
    const text = JSON.stringify(await createExportService(deps()).everything());
    expect(text).not.toMatch(/"(id|householdId|userId|vintageId|wineId|bottleId)"/);
  });

  it("an empty cellar is still a valid file", async () => {
    const data = await createExportService(
      deps({
        repo: { bottles: async () => [], tastings: async () => [] },
        places: async () => [],
        favorites: async () => [],
        wishlist: async () => ({ items: [], currency: "EUR", ready: false }),
      }),
    ).everything();
    expect(data).toMatchObject({
      bottles: [],
      tastings: [],
      places: [],
      favorites: [],
      wishlist: [],
    });
  });

  it("names the file after the day", () => {
    expect(exportFileName(new Date("2026-10-12T23:59:00Z"))).toBe("cellr-2026-10-12.json");
  });
});

describe("export version 2 (sprint 1C), next to an unchanged version 1", () => {
  /** A place as the Smart Cellar API reads it. */
  const smartPlace = (over: Partial<SmartStorageUnitView> = {}): SmartStorageUnitView => ({
    id: "p",
    label: "Wine fridge",
    kind: "fridge",
    templateId: null,
    layoutTemplateId: "cooler_single",
    family: "grid",
    rows: 3,
    cols: 4,
    cellCapacity: 1,
    slotSemantics: null,
    indexMeaning: "single",
    appearance: defaultAppearance("cooler_single"),
    zones: [],
    capacity: 12,
    occupied: 1,
    revision: "r1",
    free: 11,
    legacy: true,
    arrangementKnown: true,
    fallbacks: [],
    ...over,
  });
  /** The repository's bottles: version 1 reads them without an index, version 2 with. */
  const repoWith = (rows: ExportBottleRow[]) => ({
    bottles: async (_h: string, options: { withIndex?: boolean } = {}) =>
      options.withIndex
        ? rows
        : rows.map((r) => {
            const v1: ExportBottleRow = { ...r };
            delete v1.index;
            return v1;
          }),
    tastings: async () => [],
  });

  it("version 1 is written exactly as before: same keys in the same order, no index, no new place fields", async () => {
    const service = createExportService(
      deps({
        repo: repoWith([bottle({ index: 2 })]),
        smartPlaces: async () => [smartPlace()],
      }),
    );
    const v1 = await service.everything();
    expect(Object.keys(v1)).toEqual([
      "app",
      "version",
      "exportedAt",
      "household",
      "places",
      "bottles",
      "tastings",
      "favorites",
      "wishlist",
    ]);
    expect(v1.version).toBe(1);
    expect(Object.keys(v1.places[0]!)).toEqual(["name", "kind", "shelves", "positionsPerShelf"]);
    expect(Object.keys(v1.bottles[0]!)).toEqual([
      "producer",
      "wine",
      "vintage",
      "type",
      "country",
      "region",
      "appellation",
      "status",
      "place",
      "shelf",
      "position",
      "sizeMl",
      "price",
      "currency",
      "purchasedOn",
      "purchasedFrom",
      "notes",
      "addedAt",
      "openedAt",
    ]);
  });

  it("a cellar from before templates: every place legacy, every placed bottle at index 1", async () => {
    const data = await createExportService(
      deps({
        repo: repoWith([
          bottle({ index: 1 }),
          bottle({ status: "opened", place: null, row: null, col: null, index: 1 }),
        ]),
        smartPlaces: async () => [smartPlace()],
      }),
    ).everythingV2();
    expect(data.version).toBe(2);
    expect(data.places).toEqual([
      {
        name: "Wine fridge",
        kind: "fridge",
        template: null,
        arrangement: "legacy",
        shelves: 3,
        positionsPerShelf: 4,
        bottlesPerPosition: 1,
        capacity: 12,
        indexMeaning: "single",
        look: defaultAppearance("cooler_single"),
        zones: [],
        fallbacks: [],
      },
    ]);
    expect(data.bottles.map((b) => [b.place, b.shelf, b.position, b.index])).toEqual([
      ["Wine fridge", 2, 3, 1],
      [null, null, null, null],
    ]);
    // the rest is version 1's, word for word
    const v1 = await createExportService(
      deps({ repo: repoWith([bottle({ index: 1 })]) }),
    ).everything();
    expect(data.tastings).toEqual(v1.tastings);
    expect(data.favorites).toEqual(v1.favorites);
    expect(data.wishlist).toEqual(v1.wishlist);
    expect(data.household).toEqual(v1.household);
  });

  it("a mixed cellar: a templated cooler with zones (set, not measured), a legacy rack, an unknown template", async () => {
    const data = await createExportService(
      deps({
        repo: repoWith([
          bottle({ place: "Cooler", index: 1 }),
          bottle({ place: "Rack", index: 1 }),
          bottle({ place: "Newer", index: 1 }),
        ]),
        smartPlaces: async () => [
          smartPlace({
            label: "Cooler",
            templateId: "cooler_dual",
            layoutTemplateId: "cooler_dual",
            slotSemantics: "depth",
            rows: 8,
            cols: 4,
            capacity: 32,
            legacy: false,
            zones: [
              { fromRow: 1, toRow: 4, purpose: "storage", targetTempC: 12 },
              { fromRow: 5, toRow: 8, purpose: "serving", targetTempC: 7.5 },
            ],
          }),
          smartPlace({ label: "Rack", kind: "rack", layoutTemplateId: "rack_classic" }),
          smartPlace({
            label: "Newer",
            kind: "rack",
            templateId: "hex_rack_2031",
            layoutTemplateId: "rack_classic",
            slotSemantics: "depth",
            legacy: false,
            arrangementKnown: false,
            fallbacks: ["unknown_template"],
          }),
        ],
      }),
    ).everythingV2();
    const [cooler, rack, newer] = data.places;
    expect(cooler).toMatchObject({
      template: "cooler_dual",
      arrangement: "known",
      indexMeaning: "single",
    });
    expect(cooler!.zones).toEqual([
      { fromShelf: 1, toShelf: 4, purpose: "storage", setToC: 12 },
      { fromShelf: 5, toShelf: 8, purpose: "serving", setToC: 7.5 },
    ]);
    expect(rack).toMatchObject({ template: null, arrangement: "legacy" });
    expect(newer).toMatchObject({
      template: "hex_rack_2031",
      arrangement: "unknown",
      indexMeaning: "single",
      fallbacks: ["unknown_template"],
    });
    expect(JSON.stringify(data)).not.toMatch(/temperature"|measured|reading/i);
  });

  it("a future cellar that holds bottles two deep: the index is kept, depth only where the arrangement is known", async () => {
    const data = await createExportService(
      deps({
        repo: repoWith([
          bottle({ place: "Deep rack", row: 1, col: 1, index: 1 }),
          bottle({ place: "Deep rack", row: 1, col: 1, index: 2 }),
          bottle({ place: "Bins", row: 1, col: 2, index: 7 }),
          bottle({ place: "Unknown", row: 1, col: 1, index: 2 }),
        ]),
        smartPlaces: async () => [
          smartPlace({
            label: "Deep rack",
            kind: "rack",
            templateId: "rack_double_depth",
            cellCapacity: 2,
            indexMeaning: "depth",
            legacy: false,
          }),
          smartPlace({
            label: "Bins",
            kind: "rack",
            templateId: "diamond_bins",
            cellCapacity: 8,
            indexMeaning: "ordinal",
            legacy: false,
          }),
          smartPlace({
            label: "Unknown",
            kind: "rack",
            templateId: "hex_rack_2031",
            cellCapacity: 2,
            indexMeaning: "ordinal",
            legacy: false,
            arrangementKnown: false,
          }),
        ],
      }),
    ).everythingV2();
    expect(data.bottles.map((b) => [b.place, b.index])).toEqual([
      ["Deep rack", 1],
      ["Deep rack", 2],
      ["Bins", 7],
      ["Unknown", 2],
    ]);
    expect(data.places.map((p) => [p.name, p.indexMeaning, p.arrangement])).toEqual([
      ["Deep rack", "depth", "known"],
      ["Bins", "ordinal", "known"],
      ["Unknown", "ordinal", "unknown"],
    ]);
  });

  it("a placed bottle whose index was not read is an error, never a guess of 1", () => {
    expect(() => bottleV2(bottle())).toThrow();
    expect(bottleV2(bottle({ place: null, row: null, col: null })).index).toBeNull();
  });

  it("where the Smart Cellar API is not switched on, version 2 is not offered and nothing is read", async () => {
    let read = false;
    const service = createExportService(
      deps({
        repo: {
          bottles: async () => ((read = true), []),
          tastings: async () => [],
        },
        smartPlaces: null,
      }),
    );
    await expect(service.everythingV2()).rejects.toMatchObject({ code: "VALIDATION" });
    expect(read).toBe(false);
  });
});
