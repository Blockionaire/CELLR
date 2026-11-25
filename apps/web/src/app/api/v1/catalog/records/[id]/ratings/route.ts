import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** GET → a catalogue record's ratings (a search result shown to people); `catalog_ratings`. */
export const GET = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).ratings.forRecord(uuidParam(params.id)),
);
