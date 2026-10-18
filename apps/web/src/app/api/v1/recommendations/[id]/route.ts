import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** DELETE → dismiss a recommendation sent to me (or withdraw one I sent). */
export const DELETE = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).friends.dismissRecommendation(uuidParam(params.id)),
);
