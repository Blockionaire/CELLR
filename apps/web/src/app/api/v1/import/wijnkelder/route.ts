import { ImportRequestSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { LIMITS } from "@/server/ratelimit/service";
import { servicesFor } from "@/server/services";

/** Writing a few thousand rows takes a moment. */
export const maxDuration = 60;

/** Hosting platforms refuse bigger bodies anyway; the browser sends only the parts it needs. */
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

/**
 * POST { backup, dryRun?, scoreScale? } → what the old Wijnkelder backup would become (dryRun, the default),
 * or the same report after it has been written into the household.
 */
export const POST = authed(async ({ request, ctx }) => {
  const input = await readJson(request, ImportRequestSchema, { maxBytes: MAX_IMPORT_BYTES });
  const services = servicesFor(ctx);
  if (!input.dryRun) await services.limiter.enforce(LIMITS.import);
  return services.cellar.importWijnkelder(input);
});
