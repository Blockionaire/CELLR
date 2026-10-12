import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { vintageId: string };

/** GET → bought-or-gift and the occasion for each bottle of this vintage in the cellar. */
export const GET = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).insights.listExtras(uuidParam(params.vintageId)),
);
