import { CatalogSearchQuerySchema } from "@cellr/domain";
import { authed } from "@/server/http";
import { baseHeaders } from "@/server/http-response";
import { servicesFor } from "@/server/services";

/**
 * GET ?q=&type=&country=&region=&limit= → ranked wine names for autocomplete: the household's own wines, the
 * catalogue, and enabled provider records. Bounded (at most 20), rate-limited, searched in the database only.
 * A search the browser cancelled (the person typed on) stops at the next step instead of running to the end; it is
 * answered with an empty 499 that nobody reads, and is not logged as an error.
 */
export const GET = authed(async ({ request, ctx }) => {
  const p = new URL(request.url).searchParams;
  const input = CatalogSearchQuerySchema.parse({
    q: p.get("q") ?? "",
    type: p.get("type") ?? undefined,
    country: p.get("country") ?? undefined,
    region: p.get("region") ?? undefined,
    limit: p.get("limit") ?? undefined,
  });
  try {
    return await servicesFor(ctx).catalogSearch.search(input, request.signal);
  } catch (error) {
    // The caller is gone (the service stopped at its next step): nobody reads an answer, and it is not an error.
    if (request.signal.aborted) return new Response(null, { status: 499, headers: baseHeaders() });
    throw error;
  }
});
