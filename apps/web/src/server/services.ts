import "server-only";
import { createAnalyticsRepository } from "@/server/analytics/repository";
import { createAnalyticsService } from "@/server/analytics/service";
import { createAuthGateway } from "@/server/auth/gateway";
import { createAuthService } from "@/server/auth/service";
import type { RequestContext } from "@/server/context";
import { createHouseholdRepository } from "@/server/households/repository";
import { createHouseholdService } from "@/server/households/service";
import { createRateLimitRepository } from "@/server/ratelimit/repository";
import { createRateLimiter } from "@/server/ratelimit/service";

/**
 * Composition root. Routes and Server Components get services from here, never repositories.
 * Everything built from a RequestContext runs AS that user, so row-level security applies.
 */
export function servicesFor(ctx: RequestContext) {
  const limiter = createRateLimiter(createRateLimitRepository(ctx.db));
  return {
    households: createHouseholdService(createHouseholdRepository(ctx.db), {
      userId: ctx.userId,
      email: ctx.email,
    }),
    analytics: createAnalyticsService(createAnalyticsRepository(ctx.db), limiter),
    limiter,
  };
}

/** Auth works before anyone is signed in, so it is not tied to a RequestContext. */
export async function getAuthService() {
  return createAuthService(await createAuthGateway());
}
