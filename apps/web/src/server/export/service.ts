import "server-only";
import {
  EXPORT_VERSION,
  type CellrExport,
  type StorageUnitView,
  type WishlistView,
} from "@cellr/domain";
import type { ActiveHousehold } from "@/server/cellar/types";
import type { ExportRepository } from "./types";

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
  now?: () => Date;
}

const money = (cents: number | null) => (cents === null ? null : cents / 100);

/** Gathers the household's data into one readable document. */
export function createExportService(deps: ExportDeps) {
  const now = deps.now ?? (() => new Date());
  return {
    async everything(): Promise<CellrExport> {
      const household = await deps.household();
      const [name, places, bottles, tastings, favorites, wishlist] = await Promise.all([
        deps.householdName(household.id),
        deps.places(household.id),
        deps.repo.bottles(household.id),
        deps.repo.tastings(household.id),
        deps.favorites(household.id),
        deps.wishlist(),
      ]);
      return {
        app: "cellr",
        version: EXPORT_VERSION,
        exportedAt: now().toISOString(),
        household: { name, currency: household.currency },
        places: places.map((p) => ({
          name: p.label,
          kind: p.kind,
          shelves: p.rows,
          positionsPerShelf: p.cols,
        })),
        bottles: bottles.map((b) => ({
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
        })),
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
    },
  };
}

export type ExportService = ReturnType<typeof createExportService>;
