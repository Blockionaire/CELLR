import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { vintageId: string };

/** One vintage with every bottle of it: where each is, what they cost, what has been opened. */
export const GET = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).cellar.vintage(uuidParam(params.vintageId)),
);
