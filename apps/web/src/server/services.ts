import "server-only";
import { getLlmProvider } from "@/server/ai";
import { createAnalyticsRepository } from "@/server/analytics/repository";
import { createAnalyticsService } from "@/server/analytics/service";
import { createAccountService } from "@/server/account/service";
import { canDeleteAccounts, deleteAuthUser } from "@/server/privileged/account";
import { pinStatus, removePin, setPin } from "@/server/privileged/pin";
import { createAuthGateway } from "@/server/auth/gateway";
import { createAuthService } from "@/server/auth/service";
import { DomainError } from "@cellr/domain";
import { createCellarRepository } from "@/server/cellar/repository";
import { createCellarService } from "@/server/cellar/service";
import type { RequestContext } from "@/server/context";
import { createHouseholdRepository } from "@/server/households/repository";
import { recordAiUsage } from "@/server/privileged/ai-usage";
import { createImageRepository } from "@/server/images/repository";
import { createImageService } from "@/server/images/service";
import { createExportRepository } from "@/server/export/repository";
import { createExportService } from "@/server/export/service";
import { createFriendsRepository } from "@/server/friends/repository";
import { createFriendsService } from "@/server/friends/service";
import { getTranslations } from "next-intl/server";
import { sendFriendNotice } from "@/server/privileged/friend-notices";
import { createHouseholdService } from "@/server/households/service";
import { createRateLimitRepository } from "@/server/ratelimit/repository";
import { createRateLimiter, LIMITS } from "@/server/ratelimit/service";
import { createScanService } from "@/server/scans/service";
import { createSommelierService } from "@/server/sommelier/service";
import { createStatsService } from "@/server/stats/service";
import { createInsightsRepository } from "@/server/insights/repository";
import { createInsightsService } from "@/server/insights/service";
import { getPushEnv } from "@/server/env";
import { createPushRepository } from "@/server/push/repository";
import { createPushService } from "@/server/push/service";
import { createTasteRepository } from "@/server/taste/repository";
import { createTasteService } from "@/server/taste/service";
import { createWishlistRepository } from "@/server/wishlist/repository";
import { createWishlistService } from "@/server/wishlist/service";

/**
 * Composition root. Routes and Server Components get services from here, never repositories.
 * Everything built from a RequestContext runs AS that user, so row-level security applies.
 */
export function servicesFor(ctx: RequestContext) {
  const limiter = createRateLimiter(createRateLimitRepository(ctx.db));
  const cellars = createCellarRepository(ctx.db);
  const household = async () => {
    const found = await cellars.getActiveHousehold(ctx.userId);
    if (!found) throw new DomainError("NOT_FOUND", "Create or join a household first.");
    return found;
  };
  const images = createImageService(createImageRepository(ctx.db), household);
  const cellar = createCellarService(cellars, {
    userId: ctx.userId,
    // `insights` is built further down; it is only asked when a suggestion is made, never here.
    reservations: () => insights.reservations(),
    drinkWindows: () => insights.windows(),
  });
  const households = createHouseholdService(createHouseholdRepository(ctx.db), {
    userId: ctx.userId,
    email: ctx.email,
  });
  const insightsRepo = createInsightsRepository(ctx.db);
  const insights = createInsightsService({
    repo: insightsRepo,
    household,
    vintage: (vintageId) => cellar.vintage(vintageId),
    fillWine: (wineId, patch) => cellar.updateWine(wineId, patch),
    locale: async () => (await households.me()).locale,
    llm: getLlmProvider(),
    spend: () => limiter.enforce(LIMITS.insights),
    spendValuation: () => limiter.enforce(LIMITS.valuations),
    recordUsage: ({ householdId, task, status, usage }) =>
      recordAiUsage({ userId: ctx.userId, householdId, task, status, usage }),
  });
  const wishlist = createWishlistService({
    repo: createWishlistRepository(ctx.db),
    household,
    wineExists: async (wineId) => (await cellars.getWine(wineId)) !== null,
    bottlesByWine: async (householdId) => {
      const counts = new Map<string, number>();
      for (const row of await cellars.listInventory(householdId))
        counts.set(row.wineId, (counts.get(row.wineId) ?? 0) + 1);
      return counts;
    },
  });
  return {
    households,
    cellar,
    images,
    scans: createScanService({
      images,
      wines: async () => cellars.listWines((await household()).id),
      householdId: async () => (await household()).id,
      llm: getLlmProvider(),
      spendScan: () => limiter.enforce(LIMITS.scans),
      recordUsage: ({ householdId, task, status, usage }) =>
        recordAiUsage({ userId: ctx.userId, householdId, task, status, usage }),
    }),
    account: createAccountService({
      userId: ctx.userId,
      email: ctx.email,
      me: () => households.me(),
      household: (id) => households.getHousehold(id),
      purgePhotos: (id) => images.purge(id),
      deleteHousehold: (id) => households.deleteHousehold(id),
      leaveHousehold: (id) => households.removeMember(id, ctx.userId),
      canDelete: canDeleteAccounts,
      deleteUser: deleteAuthUser,
    }),
    wishlist,
    taste: createTasteService({
      repo: createTasteRepository(ctx.db),
      userId: ctx.userId,
      household,
    }),
    export: createExportService({
      repo: createExportRepository(ctx.db),
      household,
      householdName: async (id) =>
        (await households.me()).households.find((h) => h.id === id)?.name ?? "",
      places: (householdId) => cellars.listStorage(householdId),
      favorites: async (householdId) => {
        const starred = new Set(await cellars.listFavoriteWineIds(ctx.userId));
        return (await cellars.listWines(householdId))
          .filter((w) => starred.has(w.id))
          .map((w) => ({ producer: w.producer, wine: w.name }));
      },
      wishlist: () => wishlist.list(),
    }),
    stats: createStatsService({
      household,
      rows: async (id) => {
        const [rows, known] = await Promise.all([
          cellars.listInventory(id),
          insights.windows().catch(() => new Map<string, { from: number; until: number }>()),
        ]);
        return rows.map((r) => ({ ...r, aiWindow: known.get(r.vintageId) ?? null }));
      },
      opened: (id) => cellars.listRecentlyOpened(id, 1000),
      scores: (id) => cellars.listScores(id),
      values: async (id) => (await insightsRepo.listValues(id)) ?? [],
      spans: (id) => cellars.listBottleSpans(id),
      valuations: async (id) => (await insightsRepo.allValuations(id)) ?? [],
      ownValues: async (id) => (await insightsRepo.listOwnValues(id)) ?? new Map(),
    }),
    insights,
    friends: createFriendsService({
      repo: createFriendsRepository(ctx.db),
      userId: ctx.userId,
      notify: sendFriendNotice,
      saveToWishlist: async ({ recommendedBy, note, year, ...wine }) => {
        const t = await getTranslations("friends");
        const created = await cellar.createWine({
          producer: wine.producer,
          name: wine.name,
          type: wine.type,
          ...(wine.countryCode ? { countryCode: wine.countryCode } : {}),
          ...(wine.region ? { region: wine.region } : {}),
        });
        await wishlist.add({
          wineId: created.id,
          year,
          note: (note
            ? t("wishNoteWith", { name: recommendedBy, note })
            : t("wishNote", { name: recommendedBy })
          ).slice(0, 500),
          maxPriceCents: null,
        });
      },
    }),
    push: createPushService({
      repo: createPushRepository(ctx.db),
      env: getPushEnv(),
      wines: () => cellar.noticeWines(),
    }),
    sommelier: createSommelierService({
      cellar: () => cellar.inventory(),
      // Read only: the same household-scoped (RLS) reads the cellar screens use.
      storage: () => cellar.storage(),
      racks: () => cellar.racks(),
      tonight: (request) => cellar.tonight(request),
      llm: getLlmProvider(),
      spend: () => limiter.enforce(LIMITS.chat),
      householdId: async () => (await household()).id,
      locale: async () => (await households.me()).locale,
      recordUsage: ({ householdId, task, status, usage }) =>
        recordAiUsage({ userId: ctx.userId, householdId, task, status, usage }),
    }),
    pin: {
      status: () => pinStatus(ctx.userId),
      set: async (pin: string) => {
        await setPin(ctx.userId, pin);
        return { ready: true, enabled: true };
      },
      remove: async () => {
        await removePin(ctx.userId);
        return { ready: true, enabled: false };
      },
    },
    analytics: createAnalyticsService(createAnalyticsRepository(ctx.db), limiter),
    limiter,
  };
}

/** Auth works before anyone is signed in, so it is not tied to a RequestContext. */
export async function getAuthService() {
  return createAuthService(await createAuthGateway());
}
