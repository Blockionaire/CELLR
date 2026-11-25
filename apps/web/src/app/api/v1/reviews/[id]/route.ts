import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** DELETE → removes my public review (the tasting stays). */
export const DELETE = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).ratings.remove(uuidParam(params.id)),
);
