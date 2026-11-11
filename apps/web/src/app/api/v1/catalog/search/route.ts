import { CatalogSearchQuerySchema } from "@cellr/domain";
import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/**
 * GET ?q=&type=&country=&region=&limit= → ranked wine names for autocomplete: the household's own wines, the
 * catalogue, and enabled provider records. Bounded (at most 20), rate-limited, searched in the database only.
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
  return servicesFor(ctx).catalogSearch.search(input);
});
