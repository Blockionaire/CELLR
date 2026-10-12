import { describe, expect, it } from "vitest";
import { DomainError, type CreateStorage, type Slot } from "@cellr/domain";
import { aggregateInventory, createCellarService, toStorageView } from "./service";
import type { CellarRepository, InventoryRow, NewBottle, StorageRow } from "./types";

const WINE = {
  id: "w1",
  producer: "Château Test",
  name: "Grand Vin",
  type: "red" as const,
  countryCode: "FR",
  region: "Bordeaux",
};

/** In-memory repository: just enough behaviour to exercise the service's rules. */
function fakeRepo(
  options: {
    household?: { id: string; currency: string } | null;
    unit?: StorageRow;
    occupied?: Slot[];
    /** Make the first N inserts fail as if another person had just taken the same spot. */
    conflictsBeforeSuccess?: number;
  } = {},
) {
  const state = {
    inserts: [] as NewBottle[][],
    vintages: new Map<string, string>(),
    occupiedCalls: 0,
    conflictsLeft: options.conflictsBeforeSuccess ?? 0,
  };
  const household =
    options.household === undefined ? { id: "h1", currency: "EUR" } : options.household;
  const repo: CellarRepository = {
    async getActiveHousehold() {
      return household;
    },
    async listWines() {
      return [WINE];
    },
    async getWine(id) {
      return id === WINE.id ? WINE : null;
    },
    async findOrCreateProducer() {
      return "p1";
    },
    async findOrCreateWine() {
      return WINE;
    },
    async findOrCreateVintage(wineId, year) {
      const key = `${wineId}:${year}`;
      if (!state.vintages.has(key)) state.vintages.set(key, `v${state.vintages.size + 1}`);
      return state.vintages.get(key)!;
    },
    async listStorage() {
      return options.unit ? [options.unit] : [];
    },
    async getStorage(_h, id) {
      return options.unit && options.unit.id === id ? options.unit : null;
    },
    async occupiedSlots() {
      state.occupiedCalls += 1;
      return options.occupied ?? [];
    },
    async createStorage(_h, input: CreateStorage) {
      return {
        id: "u9",
        label: input.label,
        kind: input.kind,
        rows: input.rows,
        cols: input.cols,
        used: 0,
      };
    },
    async insertBottles(_h, rows) {
      if (state.conflictsLeft > 0) {
        state.conflictsLeft -= 1;
        throw new DomainError("CONFLICT", "That already exists.");
      }
      state.inserts.push(rows);
      return rows.map((_, i) => `b${state.inserts.length}-${i}`);
    },
    async listInventory() {
      return [];
    },
    async getVintage() {
      return null;
    },
    async getBottle() {
      return null;
    },
    async updateBottle() {
      return null;
    },
    async updatePurchase() {
      return 0;
    },
    async updateWine() {
      return null;
    },
  };
  return { repo, state };
}

const FRIDGE: StorageRow = {
  id: "u1",
  label: "Wine fridge",
  kind: "fridge",
  rows: 2,
  cols: 3,
  used: 0,
};
const wineId = WINE.id;

describe("adding bottles", () => {
  it("creates one physical bottle per unit of quantity, sharing one vintage", async () => {
    const { repo, state } = fakeRepo();
    const service = createCellarService(repo, { userId: "me" });
    const result = await service.addBottles({
      wineId,
      year: 2019,
      quantity: 3,
      locationId: null,
      priceCents: null,
      purchasedAt: null,
      formatMl: 750,
    });
    expect(result.bottleIds).toHaveLength(3);
    expect(state.inserts[0]).toHaveLength(3);
    expect(new Set(state.inserts[0]!.map((b) => b.vintageId)).size).toBe(1);
    expect(result).toMatchObject({ placed: 0, unplaced: 3, placeLabel: null, year: 2019 });
  });

  it("different years of the same wine are different vintages", async () => {
    const { repo, state } = fakeRepo();
    const service = createCellarService(repo, { userId: "me" });
    const base = {
      wineId,
      quantity: 1,
      locationId: null,
      priceCents: null,
      purchasedAt: null,
      formatMl: 750,
    };
    await service.addBottles({ ...base, year: 2018 });
    await service.addBottles({ ...base, year: 2019 });
    await service.addBottles({ ...base, year: null });
    expect(new Set(state.inserts.flat().map((b) => b.vintageId)).size).toBe(3);
  });

  it("places bottles in the next free spots, shelf by shelf", async () => {
    const { repo, state } = fakeRepo({ unit: FRIDGE, occupied: [{ row: 1, col: 1 }] });
    const service = createCellarService(repo, { userId: "me" });
    const result = await service.addBottles({
      wineId,
      year: 2020,
      quantity: 3,
      locationId: FRIDGE.id,
      priceCents: null,
      purchasedAt: null,
      formatMl: 750,
    });
    expect(state.inserts[0]!.map((b) => [b.row, b.col])).toEqual([
      [1, 2],
      [1, 3],
      [2, 1],
    ]);
    expect(state.inserts[0]!.every((b) => b.locationId === FRIDGE.id)).toBe(true);
    expect(result).toMatchObject({ placed: 3, unplaced: 0, placeLabel: "Wine fridge" });
  });

  it("when the place is too full, the rest are added without a place instead of being lost", async () => {
    const { repo, state } = fakeRepo({
      unit: FRIDGE,
      occupied: [1, 2, 3].flatMap((col) => [{ row: 1, col }]).concat([{ row: 2, col: 1 }]),
    });
    const service = createCellarService(repo, { userId: "me" });
    const result = await service.addBottles({
      wineId,
      year: 2020,
      quantity: 4,
      locationId: FRIDGE.id,
      priceCents: null,
      purchasedAt: null,
      formatMl: 750,
    });
    expect(result).toMatchObject({ placed: 2, unplaced: 2 });
    expect(state.inserts[0]!.filter((b) => b.locationId === null)).toHaveLength(2);
    expect(state.inserts[0]).toHaveLength(4);
  });

  it("keeps the price per bottle and records the household's currency only when a price is given", async () => {
    const { repo, state } = fakeRepo({ household: { id: "h1", currency: "GBP" } });
    const service = createCellarService(repo, { userId: "me" });
    const base = {
      wineId,
      year: 2020,
      quantity: 2,
      locationId: null,
      purchasedAt: "2026-10-01",
      formatMl: 750,
    };
    await service.addBottles({ ...base, priceCents: 2450 });
    await service.addBottles({ ...base, priceCents: null });
    expect(state.inserts[0]!.every((b) => b.priceCents === 2450 && b.currency === "GBP")).toBe(
      true,
    );
    expect(state.inserts[1]!.every((b) => b.priceCents === null && b.currency === null)).toBe(true);
    expect(state.inserts[0]![0]!.purchasedAt).toBe("2026-10-01");
  });

  it("looks again and takes other spots when someone grabs the same one at the same moment", async () => {
    const { repo, state } = fakeRepo({ unit: FRIDGE, conflictsBeforeSuccess: 2 });
    const service = createCellarService(repo, { userId: "me" });
    const result = await service.addBottles({
      wineId,
      year: 2020,
      quantity: 1,
      locationId: FRIDGE.id,
      priceCents: null,
      purchasedAt: null,
      formatMl: 750,
    });
    expect(result.placed).toBe(1);
    expect(state.occupiedCalls).toBe(3);
  });

  it("gives up with the conflict after a few tries instead of looping", async () => {
    const { repo } = fakeRepo({ unit: FRIDGE, conflictsBeforeSuccess: 99 });
    const service = createCellarService(repo, { userId: "me" });
    await expect(
      service.addBottles({
        wineId,
        year: 2020,
        quantity: 1,
        locationId: FRIDGE.id,
        priceCents: null,
        purchasedAt: null,
        formatMl: 750,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses an unknown wine or place, and needs a household", async () => {
    const { repo } = fakeRepo({ unit: FRIDGE });
    const service = createCellarService(repo, { userId: "me" });
    const base = { year: 2020, quantity: 1, priceCents: null, purchasedAt: null, formatMl: 750 };
    await expect(
      service.addBottles({ ...base, wineId: "nope", locationId: null }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.addBottles({ ...base, wineId, locationId: "nowhere" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const lonely = createCellarService(fakeRepo({ household: null }).repo, { userId: "me" });
    await expect(lonely.wines()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("storage", () => {
  it("reports capacity and free spots", () => {
    expect(toStorageView({ ...FRIDGE, used: 4 })).toMatchObject({ capacity: 6, used: 4, free: 2 });
    expect(toStorageView({ ...FRIDGE, used: 9 }).free).toBe(0);
  });
});

describe("the cellar view", () => {
  const row = (over: Partial<InventoryRow>): InventoryRow => ({
    bottleId: "b",
    vintageId: "v1",
    wineId: "w1",
    producer: "Château Test",
    wineName: "Grand Vin",
    type: "red",
    year: 2019,
    region: "Bordeaux",
    countryCode: "FR",
    locationId: "u1",
    locationLabel: "Wine fridge",
    row: 1,
    col: 1,
    addedAt: "2026-10-01T10:00:00Z",
    ...over,
  });

  it("collapses bottles of one vintage into one card with a count", () => {
    const view = aggregateInventory([
      row({ bottleId: "1" }),
      row({ bottleId: "2" }),
      row({ bottleId: "3" }),
    ]);
    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({ count: 3, unplaced: 0, places: ["Wine fridge"] });
    expect(view.bottleCount).toBe(3);
  });

  it("keeps vintages of the same wine apart", () => {
    const view = aggregateInventory([row({}), row({ vintageId: "v2", year: 2020 })]);
    expect(view.items.map((i) => i.year).sort()).toEqual([2019, 2020]);
    expect(view.bottleCount).toBe(2);
  });

  it("lists each place once and counts the unplaced", () => {
    const view = aggregateInventory([
      row({ bottleId: "1", locationLabel: "Wine fridge" }),
      row({ bottleId: "2", locationLabel: "Cabinet" }),
      row({ bottleId: "3", locationLabel: "Wine fridge" }),
      row({ bottleId: "4", locationLabel: null }),
    ]);
    expect(view.items[0]).toMatchObject({
      count: 4,
      unplaced: 1,
      places: ["Wine fridge", "Cabinet"],
    });
  });

  it("shows what was added most recently first", () => {
    const view = aggregateInventory([
      row({ vintageId: "old", producer: "A", addedAt: "2026-09-01T10:00:00Z" }),
      row({ vintageId: "new", producer: "Z", addedAt: "2026-10-05T10:00:00Z" }),
    ]);
    expect(view.items.map((i) => i.vintageId)).toEqual(["new", "old"]);
  });

  it("is empty for an empty cellar", () => {
    expect(aggregateInventory([])).toEqual({ items: [], bottleCount: 0 });
  });
});
