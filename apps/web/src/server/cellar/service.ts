import "server-only";
import {
  averagePrice,
  JOURNAL_LIMIT,
  summarizeJournal,
  type JournalView,
  DomainError,
  assessDrink,
  drinkStatusOf,
  drinkUrgency,
  isDomainError,
  nextFreeSlots,
  orderBottles,
  planWijnkelderImport,
  rankForTonight,
  summarizeScores,
  formatVintage,
  type AddBottles,
  type AddBottlesResult,
  type BottleAction,
  type BottleActionResult,
  type CellarItem,
  type CellarView,
  type CreateStorage,
  type CreateWine,
  type DrinkSummary,
  type NoticeWine,
  type HomeView,
  type ImportOutcome,
  type HistoryView,
  type ImageSide,
  type ImportRequest,
  type MergeWine,
  type MergeWineResult,
  type PlacedBottle,
  type OpenedEntry,
  type RackView,
  type Reservation,
  type SaveTasting,
  type StorageUnitView,
  type TastingView,
  type TonightCandidate,
  type TonightPick,
  type TonightPickView,
  type TonightRequest,
  type TonightView,
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
  TastingRow,
} from "./types";
import { runImport } from "./import-run";

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
/** Where a wine stands in its (estimated) drinking window, as the screens need it. */
export function toDrinkSummary(
  wine: {
    type: InventoryRow["type"];
    year: number | null;
    region: string | null;
    appellation: string | null;
    countryCode: string | null;
    name: string;
    pricePerBottleCents: number | null;
    aiWindow?: { from: number; until: number } | null;
  },
  now: Date,
): DrinkSummary {
  const status = assessDrink(
    drinkStatusOf(
      {
        type: wine.type,
        year: wine.year,
        region: wine.region,
        appellation: wine.appellation,
        countryCode: wine.countryCode,
        name: wine.name,
        pricePerBottleCents: wine.pricePerBottleCents,
        aiWindow: wine.aiWindow ?? null,
      },
      now,
    ),
  );
  return {
    source: status.window?.source ?? "estimate",
    reliable: status.reliable,
    uncertain: status.uncertain,
    phase: status.phase,
    from: status.window?.from ?? null,
    until: status.window?.until ?? null,
    urgency: drinkUrgency(status),
    yearsUntilOpen: status.yearsUntilOpen,
    yearsLeft: status.yearsLeft,
    position: status.position,
  };
}

export function aggregateInventory(
  rows: InventoryRow[],
  favoriteWineIds: ReadonlySet<string> = new Set(),
  scores: ReadonlyArray<{ vintageId: string; score: number }> = [],
  now: Date = new Date(),
): CellarView {
  const scoresByVintage = new Map<string, number[]>();
  for (const s of scores)
    scoresByVintage.set(s.vintageId, [...(scoresByVintage.get(s.vintageId) ?? []), s.score]);
  const byVintage = new Map<string, Omit<CellarItem, "drink"> & { latest: string }>();
  const facts = new Map<
    string,
    {
      prices: number[];
      appellation: string | null;
      aiWindow: { from: number; until: number } | null;
    }
  >();
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
        image: r.image,
        favorite: favoriteWineIds.has(r.wineId),
        rating: summarizeScores(scoresByVintage.get(r.vintageId) ?? []),
        latest: r.addedAt,
      };
      byVintage.set(r.vintageId, item);
      facts.set(r.vintageId, {
        prices: [],
        appellation: r.appellation,
        aiWindow: r.aiWindow ?? null,
      });
    }
    if (r.priceCents !== null) facts.get(r.vintageId)?.prices.push(r.priceCents);
    item.count += 1;
    if (r.addedAt > item.latest) item.latest = r.addedAt;
    item.image ??= r.image;
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
    .map((entry): CellarItem => {
      const { latest, ...item } = entry;
      void latest; // only used for ordering above
      const known = facts.get(item.vintageId);
      const prices = known?.prices ?? [];
      return {
        ...item,
        drink: toDrinkSummary(
          {
            type: item.type,
            year: item.year,
            region: item.region,
            appellation: known?.appellation ?? null,
            aiWindow: known?.aiWindow ?? null,
            countryCode: item.countryCode,
            name: item.wineName,
            pricePerBottleCents: prices.length
              ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
              : null,
          },
          now,
        ),
      };
    });
  return { items, bottleCount: rows.length };
}

export const toTastingView = (row: TastingRow, viewerId: string): TastingView => ({
  ...row,
  mine: row.userId === viewerId,
});

/** Tonight's picks, each with the one bottle to open (the easiest to reach) and where it is. */
export function buildTonight(
  rows: InventoryRow[],
  favoriteWineIds: ReadonlySet<string>,
  scores: ReadonlyArray<{ vintageId: string; score: number }>,
  request: TonightRequest,
  now: Date,
): TonightView {
  const cellar = aggregateInventory(rows, favoriteWineIds, scores, now);
  const prices = new Map<string, number[]>();
  for (const r of rows)
    if (r.priceCents !== null)
      prices.set(r.vintageId, [...(prices.get(r.vintageId) ?? []), r.priceCents]);
  const candidates: TonightCandidate[] = cellar.items.map((i) => {
    const paid = prices.get(i.vintageId) ?? [];
    return {
      vintageId: i.vintageId,
      wineId: i.wineId,
      producer: i.producer,
      wineName: i.wineName,
      type: i.type,
      year: i.year,
      region: i.region,
      countryCode: i.countryCode,
      favorite: i.favorite,
      rating: i.rating,
      drink: i.drink,
      pricePerBottleCents: paid.length
        ? Math.round(paid.reduce((a, b) => a + b, 0) / paid.length)
        : null,
    };
  });
  const view = (pick: TonightPick): TonightPickView | null => {
    const c = pick.candidate;
    const bottle = orderBottles(rows.filter((r) => r.vintageId === c.vintageId))[0];
    if (!bottle) return null;
    return {
      slot: pick.slot,
      match: pick.match,
      reasons: pick.reasons,
      vintageId: c.vintageId,
      bottleId: bottle.bottleId,
      producer: c.producer,
      wineName: c.wineName,
      type: c.type,
      year: c.year,
      region: c.region,
      countryCode: c.countryCode,
      count: rows.filter((r) => r.vintageId === c.vintageId).length,
      place:
        bottle.locationLabel !== null && bottle.row !== null && bottle.col !== null
          ? { label: bottle.locationLabel, row: bottle.row, col: bottle.col }
          : null,
      drinkPhase: c.drink.phase,
    };
  };
  return {
    dish: request.dish,
    occasion: request.occasion,
    considered: candidates.length,
    picks: rankForTonight(candidates, request, now).flatMap((p) => view(p) ?? []),
  };
}

/**
 * The numbers and short lists on Home. Value counts only bottles with a recorded price, and says how many,
 * so it never pretends to know more than it does.
 */
export function buildHome(
  rows: InventoryRow[],
  units: StorageUnitView[],
  opened: OpenedEntry[],
  favoriteWineIds: ReadonlySet<string> = new Set(),
  now: Date = new Date(),
  scores: ReadonlyArray<{ vintageId: string; score: number }> = [],
): HomeView {
  const cellar = aggregateInventory(rows, favoriteWineIds, scores, now);
  const priced = rows.filter((r) => r.priceCents !== null);
  return {
    generatedAt: now.toISOString(),
    bottleCount: cellar.bottleCount,
    wineCount: new Set(rows.map((r) => r.wineId)).size,
    valueCents: priced.length > 0 ? priced.reduce((sum, r) => sum + (r.priceCents ?? 0), 0) : null,
    pricedCount: priced.length,
    currency: priced.find((r) => r.currency)?.currency ?? null,
    capacity: units.reduce((sum, u) => sum + u.capacity, 0),
    used: units.reduce((sum, u) => sum + u.used, 0),
    unplaced: rows.filter((r) => r.locationId === null).length,
    recentlyAdded: cellar.items.slice(0, 8),
    // Only advice about this very wine (its AI profile, or the household's own window) may say "drink soon".
    drinkSoon: cellar.items
      .filter((i) => i.drink.reliable && (i.drink.phase === "ready" || i.drink.phase === "past"))
      .sort((a, b) => a.drink.urgency - b.drink.urgency)
      .slice(0, 3),
    atPeak: cellar.items
      .filter((i) => i.drink.reliable && i.drink.phase === "peak")
      .sort((a, b) => (b.drink.position ?? 0) - (a.drink.position ?? 0))
      .slice(0, 3),
    recentlyOpened: opened.map((o) => ({ ...o })),
  };
}

/** Each vintage in the cellar with its drinking window and when its first bottle that is still here came in. */
export function toNoticeWines(rows: InventoryRow[], now: Date): NoticeWine[] {
  const byVintage = new Map<string, InventoryRow[]>();
  for (const r of rows) byVintage.set(r.vintageId, [...(byVintage.get(r.vintageId) ?? []), r]);
  return [...byVintage.values()].map((group) => {
    const r = group[0]!;
    const prices = group.flatMap((g) => (g.priceCents === null ? [] : [g.priceCents]));
    const drink = toDrinkSummary(
      {
        type: r.type,
        year: r.year,
        region: r.region,
        appellation: r.appellation,
        countryCode: r.countryCode,
        name: r.wineName,
        pricePerBottleCents: prices.length
          ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
          : null,
        aiWindow: r.aiWindow ?? null,
      },
      now,
    );
    return {
      vintageId: r.vintageId,
      title: `${r.producer} ${r.wineName} ${formatVintage(r.year)}`,
      // A reminder tells someone to act: only for a window about this very wine, never the rough table.
      window:
        drink.reliable && drink.from !== null && drink.until !== null
          ? { from: drink.from, until: drink.until }
          : null,
      firstAddedAt: group.map((g) => g.addedAt).sort()[0]!,
    };
  });
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
      region: r.region,
      countryCode: r.countryCode,
      row: r.row,
      col: r.col,
      image: r.image,
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

export function createCellarService(
  repo: CellarRepository,
  {
    userId,
    now = () => new Date(),
    reservations,
    drinkWindows,
  }: {
    userId: string;
    now?: () => Date;
    /** Bottles kept for an occasion, so a suggestion can say so. Missing or failing = nothing is reserved. */
    reservations?: () => Promise<{
      vintages: ReadonlyMap<string, Reservation>;
      bottles: ReadonlySet<string>;
    }>;
    /** What the AI said about when each vintage drinks well. Missing or failing = the style table is used. */
    drinkWindows?: () => Promise<ReadonlyMap<string, { from: number; until: number }>>;
  },
) {
  const windows = () =>
    drinkWindows
      ? drinkWindows().catch(() => new Map<string, { from: number; until: number }>())
      : Promise.resolve(new Map<string, { from: number; until: number }>());
  /** The household's bottles, each with the AI's drinking window for its vintage when there is one. */
  const inventoryRows = async (householdId: string): Promise<InventoryRow[]> => {
    const [rows, known] = await Promise.all([repo.listInventory(householdId), windows()]);
    return known.size === 0
      ? rows
      : rows.map((r) => ({ ...r, aiWindow: known.get(r.vintageId) ?? null }));
  };
  const reserved = () =>
    reservations
      ? reservations().catch(() => ({
          vintages: new Map<string, Reservation>(),
          bottles: new Set<string>(),
        }))
      : Promise.resolve({ vintages: new Map<string, Reservation>(), bottles: new Set<string>() });
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

    /** The wines in the cellar as the drinking reminders see them. */
    async noticeWines(): Promise<NoticeWine[]> {
      const { id } = await household();
      return toNoticeWines(await inventoryRows(id), now());
    },

    async racks(): Promise<RackView> {
      const { id } = await household();
      const [units, rows] = await Promise.all([repo.listStorage(id), inventoryRows(id)]);
      return buildRacks(units.map(toStorageView), rows);
    },

    /** "What shall we drink tonight?": up to three bottles from this cellar, each with why. */
    async tonight(request: TonightRequest): Promise<TonightView> {
      const { id } = await household();
      const [rows, favorites, scores] = await Promise.all([
        inventoryRows(id),
        repo.listFavoriteWineIds(userId),
        repo.listScores(id),
      ]);
      const view = buildTonight(rows, new Set(favorites), scores, request, now());
      const kept = await reserved();
      return {
        ...view,
        picks: view.picks.map((pick) => {
          const reservation = kept.vintages.get(pick.vintageId) ?? null;
          if (!reservation || !kept.bottles.has(pick.bottleId))
            return { ...pick, reserved: reservation };
          // The easiest bottle is the one being kept: offer another bottle of the same wine, if there is one.
          const free = rows.find(
            (r) => r.vintageId === pick.vintageId && !kept.bottles.has(r.bottleId),
          );
          if (!free) return { ...pick, reserved: reservation };
          return {
            ...pick,
            bottleId: free.bottleId,
            place:
              free.locationLabel && free.row !== null && free.col !== null
                ? { label: free.locationLabel, row: free.row, col: free.col }
                : null,
            reserved: reservation,
          };
        }),
      };
    },

    /** Home: the cellar at a glance. */
    async home(): Promise<HomeView> {
      const { id } = await household();
      const [rows, units, opened, favorites, scores] = await Promise.all([
        inventoryRows(id),
        repo.listStorage(id),
        repo.listRecentlyOpened(id, 5),
        repo.listFavoriteWineIds(userId),
        repo.listScores(id),
      ]);
      const mine = new Map(
        (
          await repo.listMyTastingScores(
            userId,
            opened.map((o) => o.bottleId),
          )
        ).map((t) => [t.bottleId, t.score]),
      );
      const entries: OpenedEntry[] = opened.map((o) => ({
        ...o,
        myScore: mine.get(o.bottleId) ?? null,
        rated: mine.has(o.bottleId),
      }));
      return buildHome(
        rows,
        units.map(toStorageView),
        entries,
        new Set(favorites),
        new Date(),
        scores,
      );
    },

    /** Folds a duplicate wine into the right one. The duplicate has to be one the household entered itself. */
    async mergeWine(sourceWineId: string, input: MergeWine): Promise<MergeWineResult> {
      await household();
      if (sourceWineId === input.intoWineId)
        throw new DomainError("VALIDATION", "Pick a different wine to merge with.");
      const [source, target] = await Promise.all([
        repo.getWine(sourceWineId),
        repo.getWine(input.intoWineId),
      ]);
      if (!source || !target) throw new DomainError("NOT_FOUND", "We couldn't find that wine.");
      const moved = await repo.mergeWines(sourceWineId, input.intoWineId);
      const vintageId = await repo.findOrCreateVintage(input.intoWineId, input.year);
      return { moved, wineId: input.intoWineId, vintageId };
    },

    /** Bottles that have left the cellar, with a way back. */
    async history(): Promise<HistoryView> {
      const { id } = await household();
      const gone = await repo.listGone(id, 500);
      const mine = new Map(
        (
          await repo.listMyTastingScores(
            userId,
            gone.map((g) => g.bottleId),
          )
        ).map((t) => [t.bottleId, t.score]),
      );
      return {
        items: gone
          .map((g) => ({
            bottleId: g.bottleId,
            vintageId: g.vintageId,
            producer: g.producer,
            wineName: g.wineName,
            type: g.type,
            year: g.year,
            status: g.status,
            at: g.at,
            myScore: mine.get(g.bottleId) ?? null,
          }))
          .sort((a, b) => b.at.localeCompare(a.at)),
      };
    },

    async inventory(): Promise<CellarView> {
      const { id } = await household();
      const [rows, favorites, scores] = await Promise.all([
        inventoryRows(id),
        repo.listFavoriteWineIds(userId),
        repo.listScores(id),
      ]);
      const view = aggregateInventory(rows, new Set(favorites), scores, now());
      const kept = await reserved();
      return {
        ...view,
        items: view.items.map((i) => ({ ...i, reserved: kept.vintages.get(i.vintageId) ?? null })),
      };
    },

    /**
     * "How was it?": the signed-in person's stars, words and note for a bottle that has been opened.
     * Saving again replaces what they said before.
     */
    /**
     * My tasting journal: the signed-in person's own tastings in the active household, newest first (at most
     * JOURNAL_LIMIT), and a summary over all of them. Never another member's, never another household's.
     */
    async journal(): Promise<JournalView> {
      const { id: householdId } = await household();
      const [rows, scores] = await Promise.all([
        repo.listMyJournal(householdId, userId, JOURNAL_LIMIT),
        repo.listMyJournalScores(householdId, userId),
      ]);
      if (rows === null)
        return { ready: false, entries: [], truncated: false, summary: summarizeJournal([]) };
      return {
        ready: true,
        entries: rows.slice(0, JOURNAL_LIMIT),
        truncated: rows.length > JOURNAL_LIMIT,
        summary: summarizeJournal(scores),
      };
    },

    async saveTasting(bottleId: string, input: SaveTasting): Promise<TastingView> {
      const { id: householdId } = await household();
      const bottle = await repo.getBottle(householdId, bottleId);
      if (!bottle) throw new DomainError("NOT_FOUND", "We couldn't find that bottle.");
      if (bottle.status !== "opened")
        throw new DomainError("CONFLICT", "Open the bottle first, then tell us how it was.");
      const vintageId = await repo.getBottleVintage(householdId, bottleId);
      if (!vintageId) throw new DomainError("NOT_FOUND", "We couldn't find that bottle.");
      const patch = { score: input.score, descriptors: input.descriptors, note: input.note };
      const existing = await repo.getMyTasting(userId, bottleId);
      let saved: TastingRow | null;
      if (existing) saved = await repo.updateTasting(existing.id, patch);
      else {
        try {
          saved = await repo.insertTasting({ householdId, vintageId, bottleId, ...patch });
        } catch (e) {
          // Two taps at once: the other one won, so this one becomes the edit.
          if (!isDomainError(e) || e.code !== "CONFLICT") throw e;
          const again = await repo.getMyTasting(userId, bottleId);
          saved = again ? await repo.updateTasting(again.id, patch) : null;
        }
      }
      if (!saved) throw new DomainError("NOT_FOUND", "We couldn't save that.");
      return toTastingView(saved, userId);
    },

    /** Take back what you said about a bottle. */
    async deleteTasting(bottleId: string): Promise<{ deleted: boolean }> {
      await household();
      return { deleted: await repo.deleteMyTasting(userId, bottleId) };
    },

    /** Star or un-star a wine for the signed-in person only. */
    async setFavorite(
      wineId: string,
      favorite: boolean,
    ): Promise<{ wineId: string; favorite: boolean }> {
      await household();
      if (!(await repo.getWine(wineId)))
        throw new DomainError("NOT_FOUND", "We couldn't find that wine.");
      await repo.setFavorite(userId, wineId, favorite);
      return { wineId, favorite };
    },

    /** One vintage with every bottle: where each is, what they cost, what has been opened. */
    async vintage(vintageId: string): Promise<VintageDetail> {
      const { id: householdId } = await household();
      const [rows, favorites, tastings, backImage] = await Promise.all([
        repo.getVintage(householdId, vintageId),
        repo.listFavoriteWineIds(userId),
        repo.listTastings(householdId, vintageId),
        repo.latestImageRef(householdId, vintageId, "back"),
      ]);
      // A vintage you never owned a bottle of is not yours to look at, even if it is in the shared catalogue.
      if (!rows || rows.bottles.length === 0) throw new DomainError("NOT_FOUND");
      const inCellar = orderBottles(rows.bottles.filter((b) => b.status === "in_cellar"));
      const opened = rows.bottles
        .filter((b) => b.status === "opened")
        .sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? ""))
        .slice(0, 12);
      const prices = [...inCellar, ...rows.bottles.filter((b) => b.status === "opened")].flatMap(
        (b) => (b.priceCents === null ? [] : [b.priceCents]),
      );
      return {
        vintageId: rows.vintageId,
        drink: toDrinkSummary(
          {
            type: rows.wine.type,
            year: rows.year,
            region: rows.wine.region,
            appellation: rows.wine.appellation,
            countryCode: rows.wine.countryCode,
            name: rows.wine.name,
            pricePerBottleCents: prices.length
              ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
              : null,
            aiWindow: (await windows()).get(rows.vintageId) ?? null,
          },
          now(),
        ),
        wine: { ...rows.wine, favorite: favorites.includes(rows.wine.id) },
        year: rows.year,
        image: rows.image,
        backImage,
        bottles: inCellar,
        opened,
        tastings: tastings.map((t) => toTastingView(t, userId)),
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
            await repo.updateBottle(
              householdId,
              bottleId,
              { status: action.reason === "gifted" ? "gifted" : "removed" },
              ["in_cellar"],
            ),
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
    /**
     * Moving house from the old Wijnkelder app. A dry run only reads the backup and says what would
     * happen; otherwise it is written, as this person, into their household.
     */
    async importWijnkelder(input: ImportRequest): Promise<ImportOutcome> {
      const plan = planWijnkelderImport(input.backup, { scoreScale: input.scoreScale });
      if (input.dryRun) return { committed: false, report: plan.report, written: null };
      const written = await runImport(repo, await household(), userId, plan);
      return { committed: true, report: plan.report, written };
    },

    /** Gives every bottle of a vintage this label photo (replacing the one it had). */
    async attachPhoto(
      vintageId: string,
      imageId: string,
      side: ImageSide = "front",
    ): Promise<{ vintageId: string; imageId: string }> {
      const { id: householdId } = await household();
      if (!(await repo.getImageRef(householdId, imageId)))
        throw new DomainError("NOT_FOUND", "We couldn't find that photo.");
      if ((await repo.attachImage(householdId, vintageId, imageId, side)) === 0)
        throw new DomainError("NOT_FOUND");
      return { vintageId, imageId };
    },

    /** Takes the label photo off a vintage (the photo itself is kept until its household is deleted). */
    async removePhoto(vintageId: string, side: ImageSide = "front"): Promise<void> {
      const { id: householdId } = await household();
      if ((await repo.attachImage(householdId, vintageId, null, side)) === 0)
        throw new DomainError("NOT_FOUND");
    },

    async addBottles(input: AddBottles): Promise<AddBottlesResult> {
      const { id: householdId, currency } = await household();
      const wine = await repo.getWine(input.wineId);
      if (!wine) throw new DomainError("NOT_FOUND", "We couldn't find that wine.");

      const unit = input.locationId ? await repo.getStorage(householdId, input.locationId) : null;
      if (input.locationId && !unit)
        throw new DomainError("NOT_FOUND", "We couldn't find that place.");

      const vintageId = await repo.findOrCreateVintage(wine.id, input.year);
      // A photo given now is used; otherwise a new bottle shares the photo of its siblings.
      if (input.imageId && !(await repo.getImageRef(householdId, input.imageId)))
        throw new DomainError("NOT_FOUND", "We couldn't find that photo.");
      const frontImageId = input.imageId ?? (await repo.latestImageId(householdId, vintageId));

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
            purchasedFrom: input.purchasedFrom ?? null,
            frontImageId,
          };
        });
        try {
          const bottleIds = await repo.insertBottles(householdId, rows);
          return {
            wine,
            vintageId,
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
