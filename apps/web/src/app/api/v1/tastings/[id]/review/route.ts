import { PublishReviewSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** GET → my public review of this tasting, or null (`community_reviews`). */
export const GET = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).ratings.mine(uuidParam(params.id)),
);

/**
 * PUT { body?, consent: true } → publishes (or updates) my public review of one of my own tastings. Opt-in: without
 * `consent: true` nothing is published. The private note is never part of it.
 */
export const PUT = authed<Params>(async ({ request, ctx, params }) => {
  const input = await readJson(request, PublishReviewSchema);
  return servicesFor(ctx).ratings.publish(uuidParam(params.id), input);
});
