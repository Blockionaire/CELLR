import { exportFileName } from "@cellr/domain";
import { authed } from "@/server/http";
import { LIMITS } from "@/server/ratelimit/service";
import { servicesFor } from "@/server/services";

export const maxDuration = 60;

/** GET → everything the household keeps, as one readable file to download. */
export const GET = authed(async ({ ctx }) => {
  const services = servicesFor(ctx);
  await services.limiter.enforce(LIMITS.export);
  const data = await services.export.everything();
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(new Date(data.exportedAt))}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
