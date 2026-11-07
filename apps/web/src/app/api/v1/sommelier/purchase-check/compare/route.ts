import { PurchaseCheckRequestSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { LIMITS } from "@/server/ratelimit/service";
import { servicesFor } from "@/server/services";

/**
 * POST { wine, priceCents? } → Koopcheck, step 2: the confirmed wine against this household's cellar and the
 * signed-in person's own taste, worked out by plain code (no AI, so a correction costs nothing).
 */
export const POST = authed(async ({ request, ctx }) => {
  const input = await readJson(request, PurchaseCheckRequestSchema, { maxBytes: 8_000 });
  const services = servicesFor(ctx);
  await services.limiter.enforce(LIMITS.purchaseCheck);
  return services.purchaseCheck.compare(input);
});
