import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { vintageId: string };

/** POST → looks up what one bottle sells for today, on the web, with sources (at most once a month). */
export const POST = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).insights.valuate(uuidParam(params.vintageId)),
);
