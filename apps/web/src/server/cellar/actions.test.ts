import { describe, expect, it } from "vitest";
import { DomainError, type BottleView, type WineDetail } from "@cellr/domain";
import { buildRacks, createCellarService, toStorageView } from "./service";
import type {
  BottlePatch,
  BottleRow,
  CellarRepository,
  InventoryRow,
  PurchasePatch,
  StorageRow,
  VintageRows,
} from "./types";

const WINE: WineDetail = {
  id: "w1",
  producer: "Château Test",
  name: "Grand Vin",
  type: "red",
  countryCode: "FR",
  region: "Bordeaux",
  appellation: null,
};
const FRIDGE: StorageRow = {
  id: "u1",
  label: "Wine fridge",
  kind: "fridge",
  rows: 2,
  cols: 3,
  used: 0,
};

const bottle = (over: Partial<BottleView> & { id: string }): BottleRow => ({
  status: "in_cellar",
  locationId: "u1",
  locationLabel: "Wine fridge",
  row: 1,
  col: 1,
  priceCents: null,
  currency: null,
  purchasedAt: null,
  addedAt: "2026-10-01T10:00:00Z",
  openedAt: null,
  ...over,
});

/** A repository that mimics the database rules these actions rely on (status guard, slot uniqueness, location cleared on open). */
function fake(
  bottles: BottleRow[],
  options: { wineUpdatable?: boolean; wineExists?: boolean } = {},
) {
  const state = {
    bottles: [...bottles],
    updates: [] as BottlePatch[],
    purchase: [] as PurchasePatch[],
  };
  const repo: CellarRepository = {
    async getActiveHousehold() {
      return { id: "h1", currency: "EUR" };
    },
    async listWines() {
      return [];
    },
    async getWine(id) {
      return options.wineExists === false || id !== WINE.id ? null : WINE;
    },
    async findOrCreateProducer() {
      return "p1";
    },
    async findOrCreateWine() {
      return WINE;
    },
    async findOrCreateVintage() {
      return "v1";
    },
    async listStorage() {
      return [FRIDGE];
    },
    async getStorage(_h, id) {
      return id === FRIDGE.id ? FRIDGE : null;
    },
    async occupiedSlots() {
      return [];
    },
    async createStorage() {
      return FRIDGE;
    },
    async insertBottles() {
      return [];
    },
    async listInventory() {
      return [];
    },
    async getVintage(_h, vintageId): Promise<VintageRows | null> {
      return vintageId === "v1"
        ? { vintageId, year: 2019, wine: WINE, bottles: state.bottles }
        : null;
    },
    async getBottle(_h, id) {
      return state.bottles.find((b) => b.id === id) ?? null;
    },
    async updateBottle(_h, id, patch, fromStatuses) {
      state.updates.push(patch);
      const b = state.bottles.find((x) => x.id === id);
      if (!b || !fromStatuses.includes(b.status)) return null;
      const next = { ...b };
      if (patch.status) next.status = patch.status;
      if (patch.locationId !== undefined) {
        next.locationId = patch.locationId;
        next.locationLabel = patch.locationId ? FRIDGE.label : null;
      }
      if (patch.row !== undefined) next.row = patch.row;
      if (patch.col !== undefined) next.col = patch.col;
      if (patch.openedAt === null) next.openedAt = null;
      if (next.status === "opened") {
        next.locationId = null;
        next.locationLabel = null;
        next.row = null;
        next.col = null;
        next.openedAt = "2026-10-12T20:00:00Z";
      }
      // one bottle per spot
      const clash = state.bottles.some(
        (o) =>
          o.id !== id &&
          o.status === "in_cellar" &&
          next.status === "in_cellar" &&
          next.locationId !== null &&
          o.locationId === next.locationId &&
          o.row === next.row &&
          o.col === next.col,
      );
      if (clash) throw new DomainError("CONFLICT", "That already exists.");
      state.bottles = state.bottles.map((x) => (x.id === id ? next : x));
      return next;
    },
    async updatePurchase(_h, _v, patch) {
      state.purchase.push(patch);
      return state.bottles.filter((b) => b.status === "in_cellar").length;
    },
    async updateWine() {
      return options.wineUpdatable === false ? null : { ...WINE, name: "Renamed" };
    },
  };
  return { service: createCellarService(repo, { userId: "me" }), state };
}

const place = (row: number, col: number) => ({ locationId: "u1", row, col });
const nowhere = { locationId: null, row: null, col: null };

describe("opening a bottle", () => {
  it("opens one bottle: it leaves its spot and remembers where it was, for Undo", async () => {
    const { service } = fake([
      bottle({ id: "a", row: 1, col: 2 }),
      bottle({ id: "b", row: 1, col: 3 }),
    ]);
    const result = await service.bottleAction("a", { action: "open" });
    expect(result.bottle).toMatchObject({ status: "opened", locationId: null, row: null });
    expect(result.bottle.openedAt).not.toBeNull();
    expect(result.previous).toEqual({ locationId: "u1", row: 1, col: 2 });
  });

  it("cannot open the same bottle twice, even when two people tap at once", async () => {
    const { service } = fake([bottle({ id: "a" })]);
    await service.bottleAction("a", { action: "open" });
    await expect(service.bottleAction("a", { action: "open" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("an unknown bottle is simply not found", async () => {
    const { service } = fake([]);
    await expect(service.bottleAction("nope", { action: "open" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("Undo puts it back where it was; if that spot was taken meanwhile it comes back without a place", async () => {
    const { service, state } = fake([bottle({ id: "a", row: 1, col: 1 })]);
    await service.bottleAction("a", { action: "open" });
    const back = await service.bottleAction("a", { action: "restore", to: place(1, 1) });
    expect(back.bottle).toMatchObject({ status: "in_cellar", row: 1, col: 1, openedAt: null });

    await service.bottleAction("a", { action: "open" });
    state.bottles.push(bottle({ id: "c", row: 1, col: 1 })); // someone put another bottle there
    const late = await service.bottleAction("a", { action: "restore", to: place(1, 1) });
    expect(late.bottle).toMatchObject({ status: "in_cellar", locationId: null });
  });

  it("a second Undo is harmless", async () => {
    const { service } = fake([bottle({ id: "a" })]);
    await service.bottleAction("a", { action: "open" });
    await service.bottleAction("a", { action: "restore", to: nowhere });
    const again = await service.bottleAction("a", { action: "restore", to: nowhere });
    expect(again.bottle.status).toBe("in_cellar");
  });
});

describe("moving a bottle", () => {
  it("moves it to a free spot", async () => {
    const { service } = fake([bottle({ id: "a", row: 1, col: 1 })]);
    const { bottle: moved, previous } = await service.bottleAction("a", {
      action: "move",
      to: place(2, 3),
    });
    expect(moved).toMatchObject({ row: 2, col: 3, locationLabel: "Wine fridge" });
    expect(previous).toMatchObject({ row: 1, col: 1 });
  });

  it("says plainly when the spot was just taken", async () => {
    const { service } = fake([
      bottle({ id: "a", row: 1, col: 1 }),
      bottle({ id: "b", row: 2, col: 2 }),
    ]);
    await expect(
      service.bottleAction("a", { action: "move", to: place(2, 2) }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "That spot was just taken. Pick another.",
    });
  });

  it("refuses a spot outside the place, and a place that is not the household's", async () => {
    const { service } = fake([bottle({ id: "a" })]);
    await expect(
      service.bottleAction("a", { action: "move", to: place(3, 1) }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      service.bottleAction("a", { action: "move", to: place(1, 4) }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      service.bottleAction("a", {
        action: "move",
        to: { locationId: "elsewhere", row: 1, col: 1 },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("can take a bottle out of its place, and does nothing when it is moved onto itself", async () => {
    const { service, state } = fake([bottle({ id: "a", row: 1, col: 1 })]);
    const same = await service.bottleAction("a", { action: "move", to: place(1, 1) });
    expect(same.bottle.row).toBe(1);
    expect(state.updates).toHaveLength(0); // no write at all
    const out = await service.bottleAction("a", { action: "move", to: nowhere });
    expect(out.bottle).toMatchObject({ locationId: null, row: null, col: null });
  });

  it("an opened bottle cannot be moved", async () => {
    const { service } = fake([bottle({ id: "a" })]);
    await service.bottleAction("a", { action: "open" });
    await expect(
      service.bottleAction("a", { action: "move", to: place(1, 2) }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("removing a bottle works once", async () => {
    const { service } = fake([bottle({ id: "a" })]);
    expect((await service.bottleAction("a", { action: "remove" })).bottle.status).toBe("removed");
    await expect(service.bottleAction("a", { action: "remove" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("the vintage detail", () => {
  it("orders what is in the cellar, separates what was opened, and averages known prices", async () => {
    const { service } = fake([
      bottle({
        id: "u",
        locationId: null,
        locationLabel: null,
        row: null,
        col: null,
        priceCents: 3000,
        currency: "EUR",
      }),
      bottle({ id: "b", row: 1, col: 2, priceCents: 2000, currency: "EUR" }),
      bottle({ id: "a", row: 1, col: 1 }),
      bottle({
        id: "o1",
        status: "opened",
        locationId: null,
        locationLabel: null,
        row: null,
        col: null,
        openedAt: "2026-09-01T00:00:00Z",
      }),
      bottle({
        id: "o2",
        status: "opened",
        locationId: null,
        locationLabel: null,
        row: null,
        col: null,
        openedAt: "2026-10-01T00:00:00Z",
      }),
    ]);
    const detail = await service.vintage("v1");
    expect(detail.bottles.map((b) => b.id)).toEqual(["a", "b", "u"]);
    expect(detail.opened.map((b) => b.id)).toEqual(["o2", "o1"]);
    expect(detail).toMatchObject({ year: 2019, averagePriceCents: 2500, currency: "EUR" });
    expect(detail.wine.producer).toBe("Château Test");
  });

  it("is not found for a vintage the household owns no bottle of", async () => {
    await expect(fake([]).service.vintage("v1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(fake([bottle({ id: "a" })]).service.vintage("other")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("still shows a vintage whose every bottle has been opened", async () => {
    const { service } = fake([bottle({ id: "a" })]);
    await service.bottleAction("a", { action: "open" });
    const detail = await service.vintage("v1");
    expect(detail.bottles).toHaveLength(0);
    expect(detail.opened).toHaveLength(1);
  });
});

describe("editing", () => {
  it("corrects a wine the household added", async () => {
    const { service } = fake([bottle({ id: "a" })]);
    expect((await service.updateWine("w1", { name: "Renamed" })).name).toBe("Renamed");
  });

  it("explains that shared-catalogue wines cannot be edited, and that a missing wine is not found", async () => {
    await expect(
      fake([], { wineUpdatable: false }).service.updateWine("w1", { name: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      fake([], { wineExists: false }).service.updateWine("w1", { name: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("purchase edits record the household currency only when there is a price, and clear it with the price", async () => {
    const { service, state } = fake([bottle({ id: "a" }), bottle({ id: "b", row: 1, col: 2 })]);
    expect(
      await service.updatePurchase("v1", { priceCents: 2450, purchasedFrom: "Local shop" }),
    ).toEqual({ updated: 2 });
    expect(await service.updatePurchase("v1", { priceCents: null })).toEqual({ updated: 2 });
    expect(await service.updatePurchase("v1", { purchasedAt: "2026-10-01" })).toEqual({
      updated: 2,
    });
    expect(state.purchase).toEqual([
      { priceCents: 2450, currency: "EUR", purchasedFrom: "Local shop" },
      { priceCents: null, currency: null },
      { purchasedAt: "2026-10-01" },
    ]);
    await expect(service.updatePurchase("zzz", { priceCents: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("the racks view", () => {
  const row = (over: Partial<InventoryRow>): InventoryRow => ({
    bottleId: "b",
    vintageId: "v1",
    wineId: "w1",
    producer: "Château Test",
    wineName: "Grand Vin",
    type: "red",
    year: 2019,
    region: null,
    countryCode: null,
    locationId: "u1",
    locationLabel: "Wine fridge",
    row: 1,
    col: 1,
    addedAt: "2026-10-01T10:00:00Z",
    ...over,
  });
  const unit = toStorageView({ ...FRIDGE, used: 2 });

  it("puts each bottle in its spot, in reading order, and keeps the rest as unplaced", () => {
    const racks = buildRacks(
      [unit],
      [
        row({ bottleId: "c", row: 2, col: 1 }),
        row({ bottleId: "a", row: 1, col: 1 }),
        row({ bottleId: "u", locationId: null, locationLabel: null, row: null, col: null }),
      ],
    );
    expect(racks.units[0]!.bottles.map((b) => b.bottleId)).toEqual(["a", "c"]);
    expect(racks.unplaced.map((b) => b.bottleId)).toEqual(["u"]);
    expect(racks.units[0]).toMatchObject({ capacity: 6, used: 2, free: 4 });
  });

  it("a bottle that points at a unit we do not know is treated as unplaced, never dropped", () => {
    const racks = buildRacks([unit], [row({ bottleId: "x", locationId: "gone" })]);
    expect(racks.units[0]!.bottles).toHaveLength(0);
    expect(racks.unplaced.map((b) => b.bottleId)).toEqual(["x"]);
    expect(racks.unplaced[0]).toMatchObject({ row: null, col: null });
  });
});
