import "server-only";
import {
  DomainError,
  EXPORT_V2_VERSION,
  EXPORT_VERSION,
  type CellrExport,
  type CellrExportV2,
  type ExportV2Bottle,
  type ExportV2Place,
  type SmartStorageUnitView,
  type StorageUnitView,
  type WishlistView,
} from "@cellr/domain";
import type { ActiveHousehold } from "@/server/cellar/types";
import type { ExportBottleRow, ExportRepository } from "./types";

export interface ExportDeps {
  repo: ExportRepository;
  household: () => Promise<ActiveHousehold>;
  householdName: (id: string) => Promise<string>;
  places: (
    householdId: string,
  ) => Promise<Array<Pick<StorageUnitView, "label" | "kind" | "rows" | "cols">>>;
  /** Wines this person has starred, by name. */
  favorites: (householdId: string) => Promise<Array<{ producer: string; wine: string }>>;
  wishlist: () => Promise<WishlistView>;
  /**
   * Version 2 only: the places in the Smart Cellar's terms (server/smart-cellar), or null where the Smart Cellar API
   * is not switched on (version 2 is then not offered at all).
   */
  smartPlaces?: ((householdId: string) => Promise<SmartStorageUnitView[]>) | null;
  now?: () => Date;
}

/** Pure: a place in version 2's words. An index is only called a depth where the arrangement is known. */
export function toExportV2Place(u: SmartStorageUnitView): ExportV2Place {
  return {
    name: u.label,
    kind: u.kind,
    template: u.templateId,
    arrangement: u.legacy ? "legacy" : u.arrangementKnown ? "known" : "unknown",
    shelves: u.rows,
    positionsPerShelf: u.cols,
    bottlesPerPosition: u.cellCapacity,
    capacity: u.capacity,
    indexMeaning: u.indexMeaning,
    look: u.appearance,
    zones: u.zones.map((z) => ({
      fromShelf: z.fromRow,
      toShelf: z.toRow,
      purpose: z.purpose,
      setToC: z.targetTempC,
    })),
    fallbacks: u.fallbacks,
  };
}

const money = (cents: number | null) => (cents === null ? null : cents / 100);

/** Pure: one bottle in version 1's words (version 2 writes the same, and adds the index). */
const bottleV1 = (b: ExportBottleRow): CellrExport["bottles"][number] => ({
  producer: b.producer,
  wine: b.wine,
  vintage: b.year,
  type: b.type,
  country: b.country,
  region: b.region,
  appellation: b.appellation,
  status: b.status,
  place: b.place,
  shelf: b.row,
  position: b.col,
  sizeMl: b.sizeMl,
  price: money(b.priceCents),
  currency: b.currency,
  purchasedOn: b.purchasedAt,
  purchasedFrom: b.purchasedFrom,
  notes: b.notes,
  addedAt: b.addedAt,
  openedAt: b.openedAt,
});

/**
 * Pure: one bottle in version 2's words, from the SAME row (one read): its index exactly as stored, null without a
 * place. A row with a place but no index read is an error, never a guess of 1.
 */
export function bottleV2(b: ExportBottleRow): ExportV2Bottle {
  if (b.place !== null && b.index === undefined)
    throw new DomainError("INTERNAL", undefined, {
      cause: "export v2: a placed bottle without its index",
    });
  return { ...bottleV1(b), index: b.place === null ? null : (b.index ?? null) };
}

/** Gathers the household's data into one readable document. */
export function createExportService(deps: ExportDeps) {
  const now = deps.now ?? (() => new Date());

  /** What both versions write the same way. */
  async function common(household: ActiveHousehold) {
    const [name, tastings, favorites, wishlist] = await Promise.all([
      deps.householdName(household.id),
      deps.repo.tastings(household.id),
      deps.favorites(household.id),
      deps.wishlist(),
    ]);
    return {
      app: "cellr" as const,
      exportedAt: now().toISOString(),
      household: { name, currency: household.currency },
      tastings: tastings.map((t) => ({
        producer: t.producer,
        wine: t.wine,
        vintage: t.year,
        stars: t.score === null ? null : t.score / 2,
        words: t.descriptors,
        note: t.note,
        tastedAt: t.tastedAt,
        by: t.by,
      })),
      favorites,
      wishlist: wishlist.items.map((w) => ({
        producer: w.producer,
        wine: w.wineName,
        vintage: w.year,
        note: w.note,
        maxPrice: money(w.maxPriceCents),
        addedAt: w.addedAt,
      })),
    };
  }

  return {
    /** Version 1, as it has always been written. The default. */
    async everything(): Promise<CellrExport> {
      const household = await deps.household();
      const [shared, places, bottles] = await Promise.all([
        common(household),
        deps.places(household.id),
        deps.repo.bottles(household.id),
      ]);
      return {
        app: shared.app,
        version: EXPORT_VERSION,
        exportedAt: shared.exportedAt,
        household: shared.household,
        places: places.map((p) => ({
          name: p.label,
          kind: p.kind,
          shelves: p.rows,
          positionsPerShelf: p.cols,
        })),
        bottles: bottles.map(bottleV1),
        tastings: shared.tastings,
        favorites: shared.favorites,
        wishlist: shared.wishlist,
      };
    },

    /**
     * Version 2: everything version 1 has, written the same way, plus the Smart Cellar facts of every place and each
     * bottle's index (bottles and their indexes from one read). Only where the Smart Cellar API is switched on; never
     * instead of version 1.
     */
    async everythingV2(): Promise<CellrExportV2> {
      const smartPlaces = deps.smartPlaces;
      if (!smartPlaces) throw new DomainError("VALIDATION", "That export version isn't available.");
      const household = await deps.household();
      const [shared, places, bottles] = await Promise.all([
        common(household),
        smartPlaces(household.id),
        deps.repo.bottles(household.id, { withIndex: true }),
      ]);
      return {
        app: shared.app,
        version: EXPORT_V2_VERSION,
        exportedAt: shared.exportedAt,
        household: shared.household,
        places: places.map(toExportV2Place),
        bottles: bottles.map(bottleV2),
        tastings: shared.tastings,
        favorites: shared.favorites,
        wishlist: shared.wishlist,
      };
    },
  };
}

export type ExportService = ReturnType<typeof createExportService>;
