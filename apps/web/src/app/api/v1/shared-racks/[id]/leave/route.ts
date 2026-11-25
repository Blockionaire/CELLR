import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * POST → 204: I leave the rack. My bottles stay mine and stay where they stand. The last owner cannot leave (409):
 * they make someone else an owner first, or archive the rack. Nothing is handed over by leaving.
 */
export const POST = authed<Params>(async ({ ctx, params }) => {
  const id = uuidParam(params.id);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guardWrites();
  await sharedRacks.leave(id);
});
