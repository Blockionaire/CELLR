import { SharedRackEventsQuerySchema } from "@cellr/domain";
import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * GET ?before=<seq>&limit=<1..100>&owner=<userId>&actor=<userId>&placement=<placementId>&bottle=<bottleId>
 * → { events, nextBefore }: the rack's history, newest first, a page at a time (`nextBefore` is the next page's
 * `before`, or null). Each event names who did it, whose bottle it was and the wine as it read then, with the spot it
 * came from and went to. `placement` follows one bottle through the rack, also across being taken out and put back.
 * The history is append-only: nothing in it is ever changed or removed.
 */
export const GET = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guard();
  const q = new URL(request.url).searchParams;
  const query = SharedRackEventsQuerySchema.parse({
    before: q.get("before"),
    limit: q.get("limit"),
    owner: q.get("owner"),
    actor: q.get("actor"),
    placement: q.get("placement"),
    bottle: q.get("bottle"),
  });
  return sharedRacks.events(id, query);
});
