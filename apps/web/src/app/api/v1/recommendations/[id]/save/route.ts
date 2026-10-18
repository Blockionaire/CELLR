import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** POST → put the recommended wine on my wishlist, noting who recommended it. */
export const POST = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).friends.saveRecommendation(uuidParam(params.id)),
);
