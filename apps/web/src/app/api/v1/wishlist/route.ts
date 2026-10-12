import { AddWishSchema } from "@cellr/domain";
import { authed, created, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** GET → the household's wishlist, each wine with how many bottles of it are already in the cellar. */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).wishlist.list());

/** POST { wineId, year?, note?, maxPriceCents? } → puts a wine on the wishlist. */
export const POST = authed(async ({ request, ctx }) =>
  created(await servicesFor(ctx).wishlist.add(await readJson(request, AddWishSchema))),
);
