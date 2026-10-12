import "server-only";
import { getLlmProvider } from "@/server/ai";
import { createAnalyticsRepository } from "@/server/analytics/repository";
import { createAnalyticsService } from "@/server/analytics/service";
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
import { createHouseholdService } from "@/server/households/service";
import { createRateLimitRepository } from "@/server/ratelimit/repository";
import { createRateLimiter, LIMITS } from "@/server/ratelimit/service";
import { createScanService } from "@/server/scans/service";

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
  return {
    households: createHouseholdService(createHouseholdRepository(ctx.db), {
      userId: ctx.userId,
      email: ctx.email,
    }),
    cellar: createCellarService(cellars, { userId: ctx.userId }),
    images,
    scans: createScanService({
      images,
      wines: async () => cellars.listWines((await household()).id),
      householdId: async () => (await household()).id,
      llm: getLlmProvider(),
      spendScan: () => limiter.enforce(LIMITS.scans),
      recordUsage: ({ householdId, task, status, usage }) =>
        recordAiUsage({ userId: ctx.userId, householdId, task, status, ...usage }),
    }),
    analytics: createAnalyticsService(createAnalyticsRepository(ctx.db), limiter),
    limiter,
  };
}

/** Auth works before anyone is signed in, so it is not tied to a RequestContext. */
export async function getAuthService() {
  return createAuthService(await createAuthGateway());
}
