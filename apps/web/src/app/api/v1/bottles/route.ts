import { AddBottlesSchema } from "@cellr/domain";
import { authed, created, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** POST { wineId, year|null, quantity, locationId?, priceCents?, purchasedAt? } → creates that many physical bottles. */
export const POST = authed(async ({ request, ctx }) => {
  const input = await readJson(request, AddBottlesSchema);
  return created(await servicesFor(ctx).cellar.addBottles(input));
});
