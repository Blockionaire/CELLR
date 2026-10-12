import { UpdateWishSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** PATCH { year?, note?, maxPriceCents? } → changes a wish. */
export const PATCH = authed<Params>(async ({ request, ctx, params }) =>
  servicesFor(ctx).wishlist.update(uuidParam(params.id), await readJson(request, UpdateWishSchema)),
);

/** DELETE → takes it off the list (bought it, or changed our minds). */
export const DELETE = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).wishlist.remove(uuidParam(params.id)),
);
