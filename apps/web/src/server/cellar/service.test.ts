import { describe, expect, it } from "vitest";
import {
  DomainError,
  normalizeText,
  type CreateStorage,
  type Slot,
  type WineSummary,
} from "@cellr/domain";
import {
  aggregateInventory,
  buildHome,
  buildTonight,
  createCellarService,
  toDrinkSummary,
  toStorageView,
} from "./service";
import type {
  CellarRepository,
  ImportedTasting,
  InventoryRow,
  NewBottle,
  StorageRow,
} from "./types";

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
    /** Extra wines the household can see (its own or the catalogue's), found by identity. */
    known?: WineSummary[];
    /** The catalogue vintage step is not set up yet. */
    noCatalogStep?: boolean;
    /** Catalogue learning fails (database down). */
    learningFails?: boolean;
  } = {},
) {
  const state = {
    inserts: [] as NewBottle[][],
    vintages: new Map<string, string>(),
    catalogVintages: [] as string[],
    confirmations: [] as Array<{ wineId: string; year: number | null; imageId: string | null }>,
    producers: [] as Array<{ name: string; countryCode: string | null; exactCountry: boolean }>,
    occupiedCalls: 0,
    conflictsLeft: options.conflictsBeforeSuccess ?? 0,
    favorites: new Set<string>(),
    storage: [] as CreateStorage[],
    deletedStorage: [] as string[],
    deletedBottles: [] as string[],
    opened: [] as Array<{ ids: string[]; at: string | null }>,
    tastings: [] as ImportedTasting[],
    ratingsOff: false,
    images: new Set<string>(),
    latestImage: null as string | null,
    attached: [] as Array<string | null>,
    attachable: 1,
    /** The back label the (fake) database already holds for v1, if any. */
    back: null as string | null,
    failInsertAt: null as number | null,
    wines: [] as Array<{
      producerId: string;
      name: string;
      appellation?: string | null | undefined;
    }>,
  };
  const household =
    options.household === undefined ? { id: "h1", currency: "EUR" } : options.household;
  const repo: CellarRepository = {
    async listBottleSpans() {
      return [];
    },
    async getActiveHousehold() {
      return household;
    },
    async listWines() {
      return [WINE];
    },
    async getWine(id) {
      return id === WINE.id ? WINE : (options.known?.find((w) => w.id === id) ?? null);
    },
    async catalogVintage(wineId, year) {
      if (options.noCatalogStep) return null;
      state.catalogVintages.push(`${wineId}:${year}`);
      const key = `${wineId}:${year}`;
      if (!state.vintages.has(key)) state.vintages.set(key, `cv${state.vintages.size + 1}`);
      return state.vintages.get(key)!;
    },
    async recordCatalogConfirmation(wineId, year, imageId) {
      if (options.learningFails) throw new Error("catalogue learning is down");
      state.confirmations.push({ wineId, year, imageId });
      return "recorded";
    },
    async findWinesByIdentity(_h, producer, name, type) {
      const n = (t: string) => normalizeText(t);
      return (options.known ?? []).filter(
        (w) =>
          n(w.producer) === n(producer) &&
          w.type === type &&
          [w.name, ...(w.aliases ?? [])].some((x) => n(x) === n(name)),
      );
    },
    async findOrCreateProducer(_h, name, countryCode, exactCountry) {
      state.producers.push({ name, countryCode, exactCountry: exactCountry ?? false });
      return `p:${name}`;
    },
    async findOrCreateWine(_h, producerId, input) {
      state.wines.push({ producerId, name: input.name, appellation: input.appellation });
      return { ...WINE, id: `w:${producerId}:${input.name}:${input.type}`, name: input.name };
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
    async updateStorage() {
      return null;
    },
    async deleteStorage(_h, id) {
      state.deletedStorage.push(id);
      return true;
    },
    async createStorage(_h, input: CreateStorage) {
      state.storage.push(input);
      return {
        id: `u${state.storage.length + 8}`,
        label: input.label,
        kind: input.kind,
        rows: input.rows,
        cols: input.cols,
        used: 0,
      };
    },
    async insertBottles(_h, rows) {
      if (state.failInsertAt !== null && state.inserts.length === state.failInsertAt)
        throw new DomainError("INTERNAL", "The database went away.");
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
    async listRecentlyOpened() {
      return [];
    },
    async listFavoriteWineIds() {
      return [...state.favorites];
    },
    async getBottleVintage() {
      return "v1";
    },
    async listTastings() {
      return [];
    },
    async listScores() {
      return [];
    },
    async getMyTasting() {
      return null;
    },
    async insertTasting() {
      throw new Error("not used here");
    },
    async updateTasting() {
      return null;
    },
    async deleteMyTasting() {
      return false;
    },
    async listMyJournal() {
      return [];
    },
    async listMyJournalScores() {
      return [];
    },
    async listMyTastingScores() {
      return [];
    },
    async setFavorite(_user, wineId, favorite) {
      if (favorite) state.favorites.add(wineId);
      else state.favorites.delete(wineId);
    },
    async addFavorites(_user, wineIds) {
      for (const id of wineIds) state.favorites.add(id);
    },
    async getImageRef(_h, id) {
      return state.images.has(id) ? { id, blurColor: null, width: 100, height: 100 } : null;
    },
    async listGone() {
      return [];
    },
    async mergeWines() {
      return 0;
    },
    async latestImageRef() {
      return null;
    },
    async latestImageId() {
      return state.latestImage;
    },
    async attachImage(_h, _v, imageId, side) {
      state.attached.push(imageId);
      if (side === "back" && state.attachable > 0) state.back = imageId;
      return state.attachable;
    },
    async swapBottles() {
      return "not_found" as const;
    },
    async attachBackIfEmpty(_h, _v, imageId) {
      if (state.attachable === 0) return "not_found";
      if (state.back) return "exists";
      state.back = imageId;
      return "attached";
    },
    async deleteBottles(_h, ids) {
      state.deletedBottles.push(...ids);
    },
    async markOpened(_h, ids, at) {
      state.opened.push({ ids, at });
      return ids.length;
    },
    async insertTastings(rows) {
      if (state.ratingsOff) return null;
      state.tastings.push(...rows);
      return rows.length;
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

describe("favourites", () => {
  it("stars and un-stars a wine for this person; doing it twice is harmless", async () => {
    const { repo, state } = fakeRepo();
    const service = createCellarService(repo, { userId: "me" });
    expect(await service.setFavorite(wineId, true)).toEqual({ wineId, favorite: true });
    await service.setFavorite(wineId, true);
    expect([...state.favorites]).toEqual([wineId]);
    expect(await service.setFavorite(wineId, false)).toEqual({ wineId, favorite: false });
    expect([...state.favorites]).toEqual([]);
  });

  it("refuses a wine that does not exist, and needs a household", async () => {
    const { repo, state } = fakeRepo();
    const service = createCellarService(repo, { userId: "me" });
    await expect(service.setFavorite("nope", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.favorites.size).toBe(0);
    const lonely = createCellarService(fakeRepo({ household: null }).repo, { userId: "me" });
    await expect(lonely.setFavorite(wineId, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
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
    appellation: null,
    countryCode: "FR",
    locationId: "u1",
    locationLabel: "Wine fridge",
    row: 1,
    col: 1,
    priceCents: null,
    currency: null,
    addedAt: "2026-10-01T10:00:00Z",
    image: null,
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

  it("marks the wines the viewer has starred, and only those", () => {
    const view = aggregateInventory(
      [row({ vintageId: "a", wineId: "w1" }), row({ vintageId: "b", wineId: "w2", year: 2020 })],
      new Set(["w2"]),
    );
    expect(Object.fromEntries(view.items.map((i) => [i.vintageId, i.favorite]))).toEqual({
      a: false,
      b: true,
    });
  });

  it("shows what was added most recently first", () => {
    const view = aggregateInventory([
      row({ vintageId: "old", producer: "A", addedAt: "2026-09-01T10:00:00Z" }),
      row({ vintageId: "new", producer: "Z", addedAt: "2026-10-05T10:00:00Z" }),
    ]);
    expect(view.items.map((i) => i.vintageId)).toEqual(["new", "old"]);
  });

  it("shows what the household thought of a wine as a rating, and none until someone has rated it", () => {
    const view = aggregateInventory(
      [row({ vintageId: "a" }), row({ vintageId: "b", wineId: "w2", year: 2020 })],
      new Set(),
      [
        { vintageId: "a", score: 9 },
        { vintageId: "a", score: 8 },
      ],
    );
    const byId = Object.fromEntries(view.items.map((i) => [i.vintageId, i.rating]));
    expect(byId).toEqual({ a: { average: 4.3, count: 2 }, b: null });
  });

  it("is empty for an empty cellar", () => {
    expect(aggregateInventory([])).toEqual({ items: [], bottleCount: 0 });
  });
});

describe("the home view", () => {
  const row = (over: Partial<InventoryRow>): InventoryRow => ({
    bottleId: "b",
    vintageId: "v1",
    wineId: "w1",
    producer: "Château Test",
    wineName: "Grand Vin",
    type: "red",
    year: 2019,
    region: null,
    appellation: null,
    countryCode: "FR",
    locationId: "u1",
    locationLabel: "Wine fridge",
    row: 1,
    col: 1,
    priceCents: null,
    currency: null,
    addedAt: "2026-10-01T10:00:00Z",
    image: null,
    ...over,
  });
  const units = [
    toStorageView({ id: "u1", label: "Wine fridge", kind: "fridge", rows: 2, cols: 3, used: 2 }),
    toStorageView({ id: "u2", label: "Rack", kind: "rack", rows: 2, cols: 2, used: 0 }),
  ];

  it("counts bottles and distinct wines (not vintages), and the space used", () => {
    const home = buildHome(
      [
        row({ bottleId: "1", vintageId: "v1" }),
        row({ bottleId: "2", vintageId: "v2", year: 2020 }), // same wine, other vintage
        row({
          bottleId: "3",
          vintageId: "v3",
          wineId: "w2",
          locationId: null,
          locationLabel: null,
        }),
      ],
      units,
      [],
    );
    expect(home).toMatchObject({
      bottleCount: 3,
      wineCount: 2,
      capacity: 10,
      used: 2,
      unplaced: 1,
    });
  });

  it("adds up only the prices that are known, and says how many that is", () => {
    const home = buildHome(
      [
        row({ bottleId: "1", priceCents: 2450, currency: "EUR" }),
        row({ bottleId: "2", priceCents: 1000, currency: "EUR" }),
        row({ bottleId: "3" }),
      ],
      units,
      [],
    );
    expect(home).toMatchObject({ valueCents: 3450, pricedCount: 2, currency: "EUR" });
  });

  it("has no value at all when no price is known", () => {
    expect(buildHome([row({})], units, [])).toMatchObject({
      valueCents: null,
      pricedCount: 0,
      currency: null,
    });
  });

  it("lists what was added most recently (at most eight) and passes on what was opened", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({
        bottleId: `b${i}`,
        vintageId: `v${i}`,
        wineId: `w${i}`,
        wineName: `Wine ${i}`,
        addedAt: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      }),
    );
    const opened = [
      {
        bottleId: "o1",
        vintageId: "v1",
        producer: "P",
        wineName: "Opened",
        type: "red" as const,
        year: 2015,
        openedAt: "2026-10-09T20:00:00Z",
        myScore: null,
        rated: false,
      },
    ];
    const home = buildHome(rows, units, opened);
    expect(home.recentlyAdded).toHaveLength(8);
    expect(home.recentlyAdded[0]?.wineName).toBe("Wine 9");
    expect(home.recentlyOpened).toEqual(opened);
  });

  it("is quiet for an empty cellar", () => {
    expect(buildHome([], [], [], new Set(), new Date("2026-10-12T10:00:00Z"))).toEqual({
      generatedAt: "2026-10-12T10:00:00.000Z",
      drinkSoon: [],
      atPeak: [],
      bottleCount: 0,
      wineCount: 0,
      valueCents: null,
      pricedCount: 0,
      currency: null,
      capacity: 0,
      used: 0,
      unplaced: 0,
      recentlyAdded: [],
      recentlyOpened: [],
    });
  });
});

describe("when to drink it, on the cards and on Home", () => {
  const NOW = new Date("2026-10-12T12:00:00Z");
  const row = (over: Partial<InventoryRow>): InventoryRow => ({
    bottleId: "b",
    vintageId: "v1",
    wineId: "w1",
    producer: "Château Test",
    wineName: "Cuvée Test",
    type: "red",
    year: 2019,
    region: "Bordeaux",
    appellation: null,
    countryCode: "FR",
    locationId: null,
    locationLabel: null,
    row: null,
    col: null,
    priceCents: 3000,
    currency: "EUR",
    addedAt: "2026-10-01T10:00:00Z",
    image: null,
    ...over,
  });
  const phases = (rows: InventoryRow[]) =>
    Object.fromEntries(
      aggregateInventory(rows, new Set(), [], NOW).items.map((i) => [i.vintageId, i.drink.phase]),
    );

  it("every card says where its wine stands in its window", () => {
    expect(
      phases([
        // Bordeaux red, rough window 2011–2019: too uncertain to call it past its best.
        row({ vintageId: "old", year: 2008 }),
        // The same wine with an AI window for this vintage may say so.
        row({ vintageId: "oldai", year: 2008, aiWindow: { from: 2012, until: 2020 } }),
        row({ vintageId: "mid", year: 2019 }), // 2022–2030
        row({ vintageId: "new", year: 2025 }), // opens 2028
        row({ vintageId: "nv", year: null }),
      ]),
    ).toEqual({ old: "unknown", oldai: "past", mid: "peak", new: "young", nv: "unknown" });
  });

  it("uses the average of the prices paid: the dearer bottle waits longer", () => {
    const cheap = aggregateInventory([row({ priceCents: 800 })], new Set(), [], NOW).items[0]!
      .drink;
    const grand = aggregateInventory([row({ priceCents: 15000 })], new Set(), [], NOW).items[0]!
      .drink;
    expect(grand.until).toBeGreaterThan(cheap.until!);
  });

  it("describes a single wine the same way", () => {
    expect(
      toDrinkSummary(
        {
          type: "red",
          year: 2019,
          region: "Bordeaux",
          appellation: null,
          countryCode: "FR",
          name: "Cuvée Test",
          pricePerBottleCents: 3000,
        },
        NOW,
      ),
    ).toMatchObject({ phase: "peak", from: 2022, until: 2030 });
  });

  it("Home lists what to open first: past its best, then the end of the window, at most three", () => {
    const ai = (from: number, until: number) => ({ aiWindow: { from, until } });
    const rows = [
      row({ vintageId: "past", wineId: "w1", year: 2005, wineName: "Past", ...ai(2008, 2016) }),
      row({
        vintageId: "ready",
        wineId: "w2",
        year: 2015,
        region: "Beaujolais",
        wineName: "Ready",
        ...ai(2016, 2027),
      }),
      row({ vintageId: "peak", wineId: "w3", year: 2019, wineName: "Peak", ...ai(2022, 2034) }),
      row({ vintageId: "old2", wineId: "w4", year: 2009, wineName: "Old two", ...ai(2012, 2020) }),
      row({
        vintageId: "old3",
        wineId: "w5",
        year: 2010,
        wineName: "Old three",
        ...ai(2013, 2021),
      }),
      // Only a rough estimate says this one is past: never on Home.
      row({ vintageId: "rough", wineId: "w6", year: 2004, wineName: "Rough" }),
    ];
    const home = buildHome(rows, [], [], new Set(), NOW);
    expect(home.drinkSoon).toHaveLength(3);
    expect(home.drinkSoon.some((i) => i.wineName === "Rough")).toBe(false);
    expect(home.drinkSoon.every((i) => ["ready", "past"].includes(i.drink.phase))).toBe(true);
    expect(home.drinkSoon.map((i) => i.drink.urgency)).toEqual(
      [...home.drinkSoon.map((i) => i.drink.urgency)].sort((a, b) => a - b),
    );
    expect(home.drinkSoon.some((i) => i.wineName === "Peak")).toBe(false);
  });
});

describe("tonight", () => {
  const NOW = new Date("2026-10-12T12:00:00Z");
  const row = (over: Partial<InventoryRow>): InventoryRow => ({
    bottleId: "b",
    vintageId: "v1",
    wineId: "w1",
    producer: "Château Test",
    wineName: "Cuvée Test",
    type: "red",
    year: 2018,
    region: "Bordeaux",
    appellation: null,
    countryCode: "FR",
    locationId: "u1",
    locationLabel: "Wine fridge",
    row: 1,
    col: 1,
    priceCents: 3000,
    currency: "EUR",
    addedAt: "2026-10-01T10:00:00Z",
    image: null,
    ...over,
  });
  const ask = (rows: InventoryRow[], dish: string | null = null, occasion = "anything") =>
    buildTonight(
      rows,
      new Set(),
      [],
      { dish, occasion } as Parameters<typeof buildTonight>[3],
      NOW,
    );

  it("suggests from the cellar, and names the one bottle to open: the easiest to reach", () => {
    const rows = [
      row({ bottleId: "far", row: 3, col: 4 }),
      row({ bottleId: "near", row: 1, col: 2 }),
      row({ bottleId: "mid", row: 2, col: 1 }),
    ];
    const view = ask(rows, "steak");
    expect(view.considered).toBe(1);
    expect(view.picks).toHaveLength(1);
    expect(view.picks[0]).toMatchObject({
      slot: "best",
      bottleId: "near",
      count: 3,
      place: { label: "Wine fridge", row: 1, col: 2 },
      wineName: "Cuvée Test",
    });
  });

  it("a bottle without a place says so", () => {
    const view = ask([row({ locationId: null, locationLabel: null, row: null, col: null })]);
    expect(view.picks[0]?.place).toBeNull();
  });

  it("an empty cellar has nothing to suggest", () => {
    expect(ask([])).toEqual({ dish: null, occasion: "anything", considered: 0, picks: [] });
  });

  it("gives up to three different wines, the best match first", () => {
    const rows = [
      row({ vintageId: "claret", wineId: "a", wineName: "Claret", bottleId: "1" }),
      row({
        vintageId: "chablis",
        wineId: "b",
        wineName: "Chablis",
        type: "white",
        region: "Chablis",
        bottleId: "2",
      }),
      row({
        vintageId: "brut",
        wineId: "c",
        wineName: "Brut",
        type: "sparkling",
        region: "Champagne",
        bottleId: "3",
      }),
      row({ vintageId: "extra", wineId: "d", wineName: "Extra", bottleId: "4" }),
    ];
    const view = ask(rows, "steak");
    expect(view.picks.length).toBeLessThanOrEqual(3);
    expect(new Set(view.picks.map((p) => p.vintageId)).size).toBe(view.picks.length);
    expect(view.picks[0]?.type).toBe("red");
    expect(view.picks.map((p) => p.slot)[0]).toBe("best");
  });
});

describe("moving house from Wijnkelder", () => {
  const fles = (over: Record<string, unknown> = {}) => ({
    id: "f1",
    naam: "Pavillon Rouge",
    producent: "Château Margaux",
    land: "Frankrijk",
    kleur: "rood",
    jaargang: 2015,
    aantal: 2,
    appellatie: "Margaux",
    favoriet: true,
    locatie: { kelder: "Kelder", rek: "1", rij: 1, vak: 1 },
    ...over,
  });
  const backupOf = (over: Record<string, unknown> = {}) => ({
    app: "wijnkelder" as const,
    flessen: [fles()],
    notities: [],
    historie: [],
    ...over,
  });
  const request = (over: Record<string, unknown> = {}) => ({
    backup: backupOf(),
    dryRun: false,
    ...over,
  });

  it("a dry run only reports: nothing is written", async () => {
    const { repo, state } = fakeRepo();
    const result = await createCellarService(repo, { userId: "me" }).importWijnkelder(
      request({ dryRun: true }) as never,
    );
    expect(result.committed).toBe(false);
    expect(result.written).toBeNull();
    expect(result.report.counts).toMatchObject({ wines: 1, bottlesInCellar: 2 });
    expect(state.storage).toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it("writes places, wines, bottles in their spots, the opened ones backdated, tastings and stars", async () => {
    const { repo, state } = fakeRepo();
    const result = await createCellarService(repo, { userId: "me" }).importWijnkelder(
      request({
        backup: backupOf({
          historie: [{ type: "gedronken", flesId: "f1", aantal: 1, datum: "2026-03-01" }],
          notities: [
            { flesId: "f1", datum: "2026-03-01", score: 4.5, tekst: "Prachtig" },
            { flesId: "f1", datum: "2026-04-01", score: 4 },
          ],
        }),
      }) as never,
    );
    expect(result.written).toEqual({
      units: 1,
      wines: 1,
      bottles: 2,
      opened: 1,
      tastings: 2,
      favorites: 1,
      tastingsSkipped: false,
    });
    expect(state.storage).toEqual([{ label: "Rack 1", kind: "rack", rows: 1, cols: 2 }]);
    expect(state.wines).toEqual([
      { producerId: "p:Château Margaux", name: "Pavillon Rouge", appellation: "Margaux" },
    ]);
    const rows = state.inserts.flat();
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.locationId === "u9").map((r) => [r.row, r.col])).toEqual([
      [1, 1],
      [1, 2],
    ]);
    // The opened bottle has no spot; it was opened on the day the old app said.
    expect(rows.filter((r) => r.locationId === null)).toHaveLength(1);
    expect(state.opened).toEqual([{ ids: ["b1-2"], at: "2026-03-01T12:00:00.000Z" }]);
    // Of the two tasting notes, the first belongs to the opened bottle.
    expect(state.tastings.map((t) => [t.bottleId, t.score, t.tastedAt])).toEqual([
      ["b1-2", 9, "2026-03-01T12:00:00.000Z"],
      [null, 8, "2026-04-01T12:00:00.000Z"],
    ]);
    expect(state.favorites.size).toBe(1);
  });

  it("without the ratings step the cellar still comes over, and it says the ratings did not", async () => {
    const { repo, state } = fakeRepo();
    state.ratingsOff = true;
    const result = await createCellarService(repo, { userId: "me" }).importWijnkelder(
      request({
        backup: backupOf({ notities: [{ flesId: "f1", datum: "2026-03-01", score: 5 }] }),
      }) as never,
    );
    expect(result.written).toMatchObject({ bottles: 2, tastings: 0, tastingsSkipped: true });
  });

  it("a place with the same name gets a number instead of failing", async () => {
    const { repo, state } = fakeRepo({
      unit: { id: "u1", label: "Rack 1", kind: "rack", rows: 2, cols: 2, used: 0 },
    });
    await createCellarService(repo, { userId: "me" }).importWijnkelder(request() as never);
    expect(state.storage.map((s) => s.label)).toEqual(["Rack 1 (2)"]);
  });

  it("when it breaks half way, what it made is taken away again", async () => {
    const { repo, state } = fakeRepo();
    state.failInsertAt = 1; // the second batch of 500
    const big = backupOf({
      flessen: [
        fles({ aantal: 200 }),
        fles({ id: "f2", naam: "B", aantal: 200 }),
        fles({ id: "f3", naam: "C", aantal: 200 }),
      ],
    });
    await expect(
      createCellarService(repo, { userId: "me" }).importWijnkelder(
        request({ backup: big }) as never,
      ),
    ).rejects.toMatchObject({ code: "INTERNAL" });
    expect(state.deletedBottles).toHaveLength(500);
    expect(state.deletedStorage).toEqual(["u9"]);
  });

  it("refuses more than it can handle before it writes anything", async () => {
    const { repo, state } = fakeRepo();
    const flessen = Array.from({ length: 26 }, (_, i) =>
      fles({ id: `f${i}`, naam: `W${i}`, aantal: 200, locatie: {} }),
    );
    await expect(
      createCellarService(repo, { userId: "me" }).importWijnkelder(
        request({ backup: backupOf({ flessen }) }) as never,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(state.storage).toEqual([]);
    expect(state.inserts).toEqual([]);
  });
});

describe("label photos on bottles", () => {
  const add = {
    wineId,
    year: 2019,
    quantity: 2,
    locationId: null,
    priceCents: null,
    purchasedAt: null,
    formatMl: 750,
  };

  it("a new bottle of a wine you already have a photo of shares that photo", async () => {
    const { repo, state } = fakeRepo();
    state.latestImage = "photo-1";
    await createCellarService(repo, { userId: "me" }).addBottles(add);
    expect(state.inserts[0]!.map((b) => b.frontImageId)).toEqual(["photo-1", "photo-1"]);
  });

  it("a photo given now wins, and must be one of this household's", async () => {
    const { repo, state } = fakeRepo();
    state.latestImage = "old";
    state.images.add("new");
    const service = createCellarService(repo, { userId: "me" });
    await service.addBottles({ ...add, imageId: "new" });
    expect(state.inserts[0]!.every((b) => b.frontImageId === "new")).toBe(true);
    await expect(service.addBottles({ ...add, imageId: "someone-elses" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(state.inserts).toHaveLength(1); // nothing was added for the refused one
  });

  it("adding without any photo around leaves the bottles photo-less", async () => {
    const { repo, state } = fakeRepo();
    await createCellarService(repo, { userId: "me" }).addBottles(add);
    expect(state.inserts[0]!.every((b) => !b.frontImageId)).toBe(true);
  });

  it("attaching a photo needs the photo and a wine you have bottles of", async () => {
    const { repo, state } = fakeRepo();
    const service = createCellarService(repo, { userId: "me" });
    await expect(service.attachPhoto("v1", "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    state.images.add("p1");
    expect(await service.attachPhoto("v1", "p1")).toEqual({
      vintageId: "v1",
      imageId: "p1",
      attached: true,
    });
    expect(state.attached).toEqual(["p1"]);
    state.attachable = 0; // no bottle of that wine in this household
    await expect(service.attachPhoto("v1", "p1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a back label from a scan goes on only if there is none; replacing stays possible on purpose", async () => {
    const { repo, state } = fakeRepo();
    const service = createCellarService(repo, { userId: "me" });
    state.images.add("b1");
    state.images.add("b2");
    expect(await service.attachPhoto("v1", "b1", "back", { onlyIfEmpty: true })).toMatchObject({
      attached: true,
    });
    // a second one (another member, at the same moment) is told there is one and changes nothing
    expect(await service.attachPhoto("v1", "b2", "back", { onlyIfEmpty: true })).toMatchObject({
      attached: false,
    });
    expect(state.back).toBe("b1");
    // after the person said "replace it": the plain path
    expect(await service.attachPhoto("v1", "b2", "back")).toMatchObject({ attached: true });
    expect(state.back).toBe("b2");
    // the front label is never touched by any of this
    expect(state.attached.filter((id) => id !== "b2")).toEqual([]);
  });

  it("removing a photo clears it on the wine's bottles", async () => {
    const { repo, state } = fakeRepo();
    await createCellarService(repo, { userId: "me" }).removePhoto("v1");
    expect(state.attached).toEqual([null]);
  });
});

describe("the shared catalogue", () => {
  const catalogWine: WineSummary = {
    id: "cw",
    producer: "Domaine Test",
    name: "Cuvée Alpha",
    type: "red",
    countryCode: "FR",
    region: "Bourgogne",
    catalog: true,
    aliases: ["Alpha"],
  };
  const typed = {
    producer: "DOMAINE TEST",
    name: "cuvee alpha",
    type: "red" as const,
    countryCode: "FR",
  };

  it("typing a catalogue wine's exact identity uses it: no private duplicate is made", async () => {
    const { repo, state } = fakeRepo({ known: [catalogWine] });
    const service = createCellarService(repo, { userId: "me" });
    expect((await service.createWine(typed)).id).toBe("cw");
    expect((await service.createWine({ ...typed, name: "Alpha" })).id).toBe("cw");
    expect(state.wines).toHaveLength(0);
  });

  it("the household's own wine of that name is kept, never swapped for the catalogue's", async () => {
    const own: WineSummary = {
      id: "own",
      producer: catalogWine.producer,
      name: catalogWine.name,
      type: "red",
      countryCode: "FR",
      region: "Bourgogne",
    };
    const { repo, state } = fakeRepo({ known: [own, catalogWine] });
    const service = createCellarService(repo, { userId: "me" });
    expect((await service.createWine(typed)).id).toBe("own");
    expect(state.wines).toHaveLength(0);
  });

  it("the same producer, name and colour from another country is a new private wine under that country's producer", async () => {
    const ownFr: WineSummary = {
      id: "own-fr",
      producer: "Domaine Test",
      name: "Cuvée Alpha",
      type: "red",
      countryCode: "FR",
      region: null,
    };
    const { repo, state } = fakeRepo({ known: [ownFr] });
    const service = createCellarService(repo, { userId: "me" });
    const made = await service.createWine({ ...typed, countryCode: "IT" });
    expect(made.id).not.toBe("own-fr");
    expect(state.wines.map((w) => w.name)).toEqual(["cuvee alpha"]);
    // The producer of the French wine (possibly one without a country) is not reused for the Italian one.
    expect(state.producers).toEqual([
      { name: "DOMAINE TEST", countryCode: "IT", exactCountry: true },
    ]);
  });

  it("without a contradiction the producer lookup is unchanged", async () => {
    const { repo, state } = fakeRepo();
    const service = createCellarService(repo, { userId: "me" });
    await service.createWine({ ...typed, name: "Something New" });
    expect(state.producers).toEqual([
      { name: "DOMAINE TEST", countryCode: "FR", exactCountry: false },
    ]);
  });

  it("an unknown or only similar wine is made privately, as before", async () => {
    const { repo, state } = fakeRepo({ known: [catalogWine] });
    const service = createCellarService(repo, { userId: "me" });
    await service.createWine({ ...typed, name: "Cuvée Alfa" });
    await service.createWine({ ...typed, type: "white" });
    expect(state.wines.map((w) => w.name)).toEqual(["Cuvée Alfa", "cuvee alpha"]);
  });

  it("a bottle of a catalogue wine in a year the catalogue does not list yet gets that year safely", async () => {
    const { repo, state } = fakeRepo({ known: [catalogWine] });
    const service = createCellarService(repo, { userId: "me" });
    const add = (year: number | null) =>
      service.addBottles({
        wineId: "cw",
        year,
        quantity: 1,
        locationId: null,
        priceCents: null,
        purchasedAt: null,
        formatMl: 750,
      });
    const first = await add(2015);
    const again = await add(2015);
    await add(null);
    expect(first.vintageId).toBe(again.vintageId);
    expect(state.catalogVintages).toEqual(["cw:2015", "cw:2015", "cw:null"]);
  });

  it("before the catalogue step exists, a catalogue wine's listed year still works as before", async () => {
    const { repo } = fakeRepo({ known: [catalogWine], noCatalogStep: true });
    const service = createCellarService(repo, { userId: "me" });
    await expect(
      service.addBottles({
        wineId: "cw",
        year: 2019,
        quantity: 1,
        locationId: null,
        priceCents: null,
        purchasedAt: null,
        formatMl: 750,
      }),
    ).resolves.toMatchObject({ year: 2019 });
  });

  it("the household's own wines never go through the catalogue step", async () => {
    const { repo, state } = fakeRepo();
    const service = createCellarService(repo, { userId: "me" });
    await service.addBottles({
      wineId,
      year: 2019,
      quantity: 1,
      locationId: null,
      priceCents: null,
      purchasedAt: null,
      formatMl: 750,
    });
    expect(state.catalogVintages).toHaveLength(0);
  });
});

describe("catalogue learning", () => {
  const add = (wine: string, imageId?: string) => ({
    wineId: wine,
    year: 2019,
    quantity: 5,
    locationId: null,
    priceCents: 2500,
    purchasedAt: null,
    formatMl: 750,
    ...(imageId ? { imageId } : {}),
  });

  it("adding bottles of a household wine offers one confirmation, with the scan photo, and nothing private", async () => {
    const { repo, state } = fakeRepo();
    state.images.add("00000000-0000-4000-8000-0000000000aa");
    const service = createCellarService(repo, { userId: "me" });
    await service.addBottles(add(wineId, "00000000-0000-4000-8000-0000000000aa"));
    expect(state.confirmations).toEqual([
      { wineId, year: 2019, imageId: "00000000-0000-4000-8000-0000000000aa" },
    ]);
  });

  it("a catalogue wine is not proposed again", async () => {
    const cw: WineSummary = {
      id: "cw",
      producer: "P",
      name: "N",
      type: "red",
      countryCode: "FR",
      region: null,
      catalog: true,
    };
    const { repo, state } = fakeRepo({ known: [cw] });
    await createCellarService(repo, { userId: "me" }).addBottles(add("cw"));
    expect(state.confirmations).toHaveLength(0);
  });

  it("when catalogue learning fails, the bottles are still added", async () => {
    const { repo, state } = fakeRepo({ learningFails: true });
    const result = await createCellarService(repo, { userId: "me" }).addBottles(add(wineId));
    expect(result.bottleIds).toHaveLength(5);
    expect(state.inserts).toHaveLength(1);
  });
});
