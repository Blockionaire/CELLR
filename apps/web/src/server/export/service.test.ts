import { describe, expect, it } from "vitest";
import { exportFileName } from "@cellr/domain";
import { createExportService } from "./service";
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
