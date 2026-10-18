import { RecommendSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** GET → wines my friends recommended to me, newest first, and how many are new. */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).friends.recommendations());

/** POST { vintageId, friendIds, note? } → recommend one of my wines to those friends. */
export const POST = authed(async ({ request, ctx }) =>
  servicesFor(ctx).friends.recommend(await readJson(request, RecommendSchema)),
);
