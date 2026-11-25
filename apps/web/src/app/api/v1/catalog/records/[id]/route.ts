import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** GET → a provider record shown to people, for its catalogue page (`catalog_ratings`). */
export const GET = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).ratings.record(uuidParam(params.id)),
);
