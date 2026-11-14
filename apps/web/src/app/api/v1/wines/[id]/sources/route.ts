import { DomainError } from "@cellr/domain";
import { getFeatures } from "@/server/env";
import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * GET → what a wine page may credit for this wine: the pages CELLR's catalogue check rests on, and the external
 * sources cleared and shown to people whose record was verifiably linked to it. Part of the `sources_panel`
 * feature: without it the route does not exist.
 */
export const GET = authed<Params>(async ({ ctx, params }) => {
  if (!getFeatures().sources_panel) throw new DomainError("NOT_FOUND");
  return servicesFor(ctx).wineSources.get(uuidParam(params.id));
});
