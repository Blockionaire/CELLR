import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** GET → one place of the active household in the new terms (see ../route.ts). 404 for anyone else's. */
export const GET = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).smartCellar.unit(uuidParam(params.id)),
);
