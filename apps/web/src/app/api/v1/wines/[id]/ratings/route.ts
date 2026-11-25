import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * GET → a wine's ratings: its record's external aggregates per vintage and the CELLR community's published reviews
 * (`catalog_ratings`, `community_reviews`; without the first the route does not exist).
 */
export const GET = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).ratings.forWine(uuidParam(params.id)),
);
