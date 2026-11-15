import { DomainError, exportFileName } from "@cellr/domain";
import { authed } from "@/server/http";
import { LIMITS } from "@/server/ratelimit/service";
import { servicesFor } from "@/server/services";

export const maxDuration = 60;

/**
 * GET → everything the household keeps, as one readable file to download: export version 1, as always.
 * GET ?version=2 → version 2 (sprint 1C): version 1 plus each place's template, bottles per position, look and
 * temperature zones, and each bottle's index. Only where the Smart Cellar API reads; anywhere else, and for any other
 * version, 422 and nothing is read.
 */
export const GET = authed(async ({ request, ctx }) => {
  const version = new URL(request.url).searchParams.get("version") ?? "1";
  if (version !== "1" && version !== "2")
    throw new DomainError("VALIDATION", "That export version isn't available.");
  const services = servicesFor(ctx);
  await services.limiter.enforce(LIMITS.export);
  const data =
    version === "2" ? await services.export.everythingV2() : await services.export.everything();
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(new Date(data.exportedAt))}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
