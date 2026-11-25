import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** POST → the rack, in use again after it was archived. Owners only. */
export const POST = authed<Params>(async ({ ctx, params }) => {
  const id = uuidParam(params.id);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guardWrites();
  return sharedRacks.setArchived(id, false);
});
