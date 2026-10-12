import "server-only";
import {
  averagePrice,
  DomainError,
  isDomainError,
  nextFreeSlots,
  orderBottles,
  type AddBottles,
  type AddBottlesResult,
  type BottleAction,
  type BottleActionResult,
  type CellarItem,
  type CellarView,
  type CreateStorage,
  type CreateWine,
  type PlacedBottle,
  type RackView,
  type StorageUnitView,
  type UpdatePurchase,
  type UpdateStorage,
  type UpdateWine,
  type VintageDetail,
  type WineSummary,
} from "@cellr/domain";
import type {
  ActiveHousehold,
  CellarRepository,
  InventoryRow,
  NewBottle,
  PurchasePatch,
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

/** Every storage unit with what sits in each spot, plus the bottles that have no place yet. */
export function buildRacks(units: StorageUnitView[], rows: InventoryRow[]): RackView {
  const racks = units.map((u) => ({ ...u, bottles: [] as PlacedBottle[] }));
  const byId = new Map(racks.map((r) => [r.id, r]));
  const unplaced: PlacedBottle[] = [];
  for (const r of rows) {
    const bottle: PlacedBottle = {
      bottleId: r.bottleId,
      vintageId: r.vintageId,
      producer: r.producer,
      wineName: r.wineName,
      type: r.type,
      year: r.year,
      row: r.row,
      col: r.col,
    };
    const unit =
      r.locationId && r.row !== null && r.col !== null ? byId.get(r.locationId) : undefined;
    if (unit) unit.bottles.push(bottle);
    else unplaced.push({ ...bottle, row: null, col: null });
  }
  for (const unit of racks)
    unit.bottles.sort((a, b) => (a.row ?? 0) - (b.row ?? 0) || (a.col ?? 0) - (b.col ?? 0));
  unplaced.sort(
    (a, b) => a.producer.localeCompare(b.producer) || a.wineName.localeCompare(b.wineName),
  );
  return { units: racks, unplaced };
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

    /** For the racks view and the 3D cellar: where every bottle sits. */
    /** Renames, re-kinds or resizes a place; the database refuses to shrink it past bottles still in it. */
    async updateStorage(id: string, patch: UpdateStorage): Promise<StorageUnitView> {
      const { id: householdId } = await household();
      const updated = await repo.updateStorage(householdId, id, patch);
      if (!updated) throw new DomainError("NOT_FOUND", "We couldn't find that place.");
      return toStorageView(updated);
    },

    /** Deletes an empty place. Only the household's owner may; a place with bottles in it stays. */
    async deleteStorage(id: string): Promise<void> {
      const { id: householdId } = await household();
      const unit = await repo.getStorage(householdId, id);
      if (!unit) throw new DomainError("NOT_FOUND", "We couldn't find that place.");
      if (unit.used > 0)
        throw new DomainError("CONFLICT", "There are still bottles in it. Move them out first.");
      if (!(await repo.deleteStorage(householdId, id)))
        throw new DomainError("FORBIDDEN", "Only the household's owner can delete a place.");
    },

    async racks(): Promise<RackView> {
      const { id } = await household();
      const [units, rows] = await Promise.all([repo.listStorage(id), repo.listInventory(id)]);
      return buildRacks(units.map(toStorageView), rows);
    },

    async inventory(): Promise<CellarView> {
      return aggregateInventory(await repo.listInventory((await household()).id));
    },

    /** One vintage with every bottle: where each is, what they cost, what has been opened. */
    async vintage(vintageId: string): Promise<VintageDetail> {
      const { id: householdId } = await household();
      const rows = await repo.getVintage(householdId, vintageId);
      // A vintage you never owned a bottle of is not yours to look at, even if it is in the shared catalogue.
      if (!rows || rows.bottles.length === 0) throw new DomainError("NOT_FOUND");
      const inCellar = orderBottles(rows.bottles.filter((b) => b.status === "in_cellar"));
      const opened = rows.bottles
        .filter((b) => b.status === "opened")
        .sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? ""))
        .slice(0, 12);
      return {
        vintageId: rows.vintageId,
        wine: rows.wine,
        year: rows.year,
        bottles: inCellar,
        opened,
        averagePriceCents: averagePrice(inCellar),
        currency: inCellar.find((b) => b.currency)?.currency ?? null,
      };
    },

    /**
     * Open, move, restore or remove ONE physical bottle. Each action says what it expects the bottle's
     * state to be, so two people tapping at once cannot open the same bottle twice.
     */
    async bottleAction(bottleId: string, action: BottleAction): Promise<BottleActionResult> {
      const { id: householdId } = await household();
      const before = await repo.getBottle(householdId, bottleId);
      if (!before) throw new DomainError("NOT_FOUND", "We couldn't find that bottle.");
      const previous = { locationId: before.locationId, row: before.row, col: before.col };
      const result = (bottle: typeof before | null, conflict: string): BottleActionResult => {
        if (!bottle) throw new DomainError("CONFLICT", conflict);
        return { bottle, previous };
      };

      switch (action.action) {
        case "open":
          return result(
            await repo.updateBottle(householdId, bottleId, { status: "opened" }, ["in_cellar"]),
            "That bottle has already been opened.",
          );

        case "remove":
          return result(
            await repo.updateBottle(householdId, bottleId, { status: "removed" }, ["in_cellar"]),
            "That bottle is no longer in the cellar.",
          );

        case "move": {
          if (before.status !== "in_cellar")
            throw new DomainError("CONFLICT", "That bottle is no longer in the cellar.");
          const { locationId, row, col } = action.to;
          if (locationId === before.locationId && row === before.row && col === before.col)
            return { bottle: before, previous };
          if (locationId) {
            const unit = await repo.getStorage(householdId, locationId);
            if (!unit) throw new DomainError("NOT_FOUND", "We couldn't find that place.");
            if ((row ?? 0) > unit.rows || (col ?? 0) > unit.cols)
              throw new DomainError("VALIDATION", "That spot doesn't exist in this place.");
          }
          try {
            return result(
              await repo.updateBottle(householdId, bottleId, { locationId, row, col }, [
                "in_cellar",
              ]),
              "That bottle is no longer in the cellar.",
            );
          } catch (error) {
            if (isDomainError(error) && error.code === "CONFLICT")
              throw new DomainError("CONFLICT", "That spot was just taken. Pick another.");
            throw error;
          }
        }

        case "restore": {
          if (before.status === "in_cellar") return { bottle: before, previous }; // a second Undo is harmless
          const attempt = (to: {
            locationId: string | null;
            row: number | null;
            col: number | null;
          }) =>
            repo.updateBottle(
              householdId,
              bottleId,
              { status: "in_cellar", ...to, openedAt: null },
              ["opened", "removed", "gifted"],
            );
          const wanted = action.to;
          let restored;
          try {
            restored = await attempt(wanted);
          } catch (error) {
            // Its old spot was taken meanwhile: put it back anyway, just without a place.
            if (!(isDomainError(error) && error.code === "CONFLICT" && wanted.locationId))
              throw error;
            restored = await attempt({ locationId: null, row: null, col: null });
          }
          return result(restored, "That bottle can't be put back.");
        }
      }
    },

    /** Corrects a wine the household added itself (the shared catalogue is read-only). */
    async updateWine(wineId: string, patch: UpdateWine): Promise<WineSummary> {
      await household();
      if (!(await repo.getWine(wineId))) throw new DomainError("NOT_FOUND");
      const updated = await repo.updateWine(wineId, patch);
      if (!updated)
        throw new DomainError(
          "FORBIDDEN",
          "That wine comes from the shared catalogue, so it can't be edited.",
        );
      return updated;
    },

    /** Price, date and shop for every bottle of a vintage that is still in the cellar. */
    async updatePurchase(vintageId: string, patch: UpdatePurchase): Promise<{ updated: number }> {
      const { id: householdId, currency } = await household();
      const rows = await repo.getVintage(householdId, vintageId);
      if (!rows || rows.bottles.length === 0) throw new DomainError("NOT_FOUND");
      const update: PurchasePatch = {};
      if (patch.priceCents !== undefined) {
        update.priceCents = patch.priceCents;
        update.currency = patch.priceCents === null ? null : currency;
      }
      if (patch.purchasedAt !== undefined) update.purchasedAt = patch.purchasedAt;
      if (patch.purchasedFrom !== undefined) update.purchasedFrom = patch.purchasedFrom;
      return { updated: await repo.updatePurchase(householdId, vintageId, update) };
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
