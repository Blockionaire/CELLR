import { BottleExtrasSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** PUT { acquiredHow, giftFrom, occasionTitle, occasionOn } → what we know about this bottle (all empty clears it). */
export const PUT = authed<Params>(async ({ request, ctx, params }) =>
  servicesFor(ctx).insights.saveExtras(
    uuidParam(params.id),
    await readJson(request, BottleExtrasSchema),
  ),
);
