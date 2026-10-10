import "server-only";
import { createAuthGateway } from "@/server/auth/gateway";
import { createAuthService } from "@/server/auth/service";
import type { RequestContext } from "@/server/context";
import { createHouseholdRepository } from "@/server/households/repository";
import { createHouseholdService } from "@/server/households/service";

/**
 * Composition root. Routes and Server Components get services from here, never repositories.
 * Everything built from a RequestContext runs AS that user, so row-level security applies.
 */
export function servicesFor(ctx: RequestContext) {
  return {
    households: createHouseholdService(createHouseholdRepository(ctx.db), {
      userId: ctx.userId,
      email: ctx.email,
    }),
  };
}

/** Auth works before anyone is signed in, so it is not tied to a RequestContext. */
export async function getAuthService() {
  return createAuthService(await createAuthGateway());
}
