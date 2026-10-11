import "server-only";
import {
  DomainError,
  isDomainError,
  nextFreeSlots,
  type AddBottles,
  type AddBottlesResult,
  type CellarItem,
  type CellarView,
  type CreateStorage,
  type CreateWine,
  type StorageUnitView,
  type WineSummary,
} from "@cellr/domain";
import type {
  ActiveHousehold,
  CellarRepository,
  InventoryRow,
  NewBottle,
  StorageRow,
} from "./types";

/** How many times a add retries when two people grab the same free spot at the same moment. */
const PLACEMENT_ATTEMPTS = 3;

export const toStorageView = (r: StorageRow): StorageUnitView => {
  const capacity = r.rows * r.cols;
  return {
    id: r.id,
    label: r.label,
    kind: r.kind,
    rows: r.rows,
    cols: r.cols,
    capacity,
    used: r.used,
    free: Math.max(0, capacity - r.used),
  };
};

/**
 * One card per vintage: the individual bottles of a wine collapse into "×3". Newest additions first,
 * so what you just added is the first thing you see.
 */
export function aggregateInventory(rows: InventoryRow[]): CellarView {
  const byVintage = new Map<string, CellarItem & { latest: string }>();
  for (const r of rows) {
    let item = byVintage.get(r.vintageId);
    if (!item) {
      item = {
        vintageId: r.vintageId,
        wineId: r.wineId,
        producer: r.producer,
        wineName: r.wineName,
        type: r.type,
        year: r.year,
        region: r.region,
        countryCode: r.countryCode,
        count: 0,
        places: [],
        unplaced: 0,
        latest: r.addedAt,
      };
      byVintage.set(r.vintageId, item);
    }
    item.count += 1;
    if (r.addedAt > item.latest) item.latest = r.addedAt;
    if (r.locationLabel === null) item.unplaced += 1;
    else if (!item.places.includes(r.locationLabel)) item.places.push(r.locationLabel);
  }
  const items = [...byVintage.values()]
    .sort(
      (a, b) =>
        b.latest.localeCompare(a.latest) ||
        a.producer.localeCompare(b.producer) ||
        a.wineName.localeCompare(b.wineName),
    )
    .map((entry) => {
      const { latest, ...item } = entry;
      void latest; // only used for ordering above
      return item;
    });
  return { items, bottleCount: rows.length };
}

export function createCellarService(repo: CellarRepository, { userId }: { userId: string }) {
  async function household(): Promise<ActiveHousehold> {
    const h = await repo.getActiveHousehold(userId);
    if (!h) throw new DomainError("NOT_FOUND", "Create or join a household first.");
    return h;
  }

  return {
    /** Wines the household can choose from when adding a bottle. */
    async wines(): Promise<WineSummary[]> {
      return repo.listWines((await household()).id);
    },

    /** Adds a wine, or returns the one that is already there under the same (accent-insensitive) name. */
    async createWine(input: CreateWine): Promise<WineSummary> {
      const { id } = await household();
      const producerId = await repo.findOrCreateProducer(
        id,
        input.producer,
        input.countryCode ?? null,
      );
      return repo.findOrCreateWine(id, producerId, input);
    },

    async storage(): Promise<StorageUnitView[]> {
      return (await repo.listStorage((await household()).id)).map(toStorageView);
    },

    async createStorage(input: CreateStorage): Promise<StorageUnitView> {
      return toStorageView(await repo.createStorage((await household()).id, input));
    },

    async inventory(): Promise<CellarView> {
      return aggregateInventory(await repo.listInventory((await household()).id));
    },

    /**
     * "3 bottles of this vintage, in the wine fridge" → three physical bottle records, placed in the
     * next free spots. If the place is too full for all of them, the rest are added unplaced (never lost).
     */
    async addBottles(input: AddBottles): Promise<AddBottlesResult> {
      const { id: householdId, currency } = await household();
      const wine = await repo.getWine(input.wineId);
      if (!wine) throw new DomainError("NOT_FOUND", "We couldn't find that wine.");

      const unit = input.locationId ? await repo.getStorage(householdId, input.locationId) : null;
      if (input.locationId && !unit)
        throw new DomainError("NOT_FOUND", "We couldn't find that place.");

      const vintageId = await repo.findOrCreateVintage(wine.id, input.year);

      for (let attempt = 1; ; attempt++) {
        const slots = unit
          ? nextFreeSlots(
              { rows: unit.rows, cols: unit.cols },
              await repo.occupiedSlots(unit.id),
              input.quantity,
            )
          : [];
        const rows: NewBottle[] = Array.from({ length: input.quantity }, (_, i) => {
          const slot = slots[i];
          return {
            vintageId,
            formatMl: input.formatMl,
            locationId: unit && slot ? unit.id : null,
            row: slot?.row ?? null,
            col: slot?.col ?? null,
            priceCents: input.priceCents,
            currency: input.priceCents === null ? null : currency,
            purchasedAt: input.purchasedAt,
          };
        });
        try {
          const bottleIds = await repo.insertBottles(householdId, rows);
          return {
            wine,
            year: input.year,
            bottleIds,
            placed: slots.length,
            unplaced: input.quantity - slots.length,
            placeLabel: unit?.label ?? null,
          };
        } catch (error) {
          // Someone filled the same spot a moment ago: look again and take the next free ones.
          if (
            isDomainError(error) &&
            error.code === "CONFLICT" &&
            unit &&
            attempt < PLACEMENT_ATTEMPTS
          )
            continue;
          throw error;
        }
      }
    },
  };
}

export type CellarService = ReturnType<typeof createCellarService>;
