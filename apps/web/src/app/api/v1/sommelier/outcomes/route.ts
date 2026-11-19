import { DomainError, SetSommelierOutcomeSchema } from "@cellr/domain";
import { getFeatures } from "@/server/env";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/**
 * PUT { messageId, vintageId, opened, withDish?, enjoyed? } → { outcome }: what came of one bottle one of your
 * answers offered (opened; had with the dish; how the two went together), or `opened: false` to take it back.
 * Its own record: not a rating of the answer. Part of the `sommelier_learning` feature: without it the route does
 * not exist.
 */
export const PUT = authed(async ({ request, ctx }) => {
  if (!getFeatures().sommelier_learning) throw new DomainError("NOT_FOUND");
  return servicesFor(ctx).sommelierChat.outcome(await readJson(request, SetSommelierOutcomeSchema));
});
