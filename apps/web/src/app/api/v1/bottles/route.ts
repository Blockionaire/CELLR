import { AddBottlesSchema } from "@cellr/domain";
import { authed, created, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/**
 * POST { wineId, year|null, quantity, locationId?, slot?, priceCents?, purchasedAt? } → creates that many physical
 * bottles. With `slot` the first one goes on exactly that spot (409 if it is taken), the rest on the next free ones.
 */
export const POST = authed(async ({ request, ctx }) => {
  const input = await readJson(request, AddBottlesSchema);
  return created(await servicesFor(ctx).cellar.addBottles(input));
});
