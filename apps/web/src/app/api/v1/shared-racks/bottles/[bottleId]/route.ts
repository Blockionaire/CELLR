import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { bottleId: string };

/**
 * DELETE → 204: "my bottle is no longer in that rack". For the bottle's own household, WITH OR WITHOUT access to the
 * rack: someone who left a rack or was removed from it can always get their own bottle's record back. The bottle
 * itself is not changed. 404 for a bottle that is not mine (or does not exist); 409 when it is in no shared rack.
 */
export const DELETE = authed<Params>(async ({ ctx, params }) => {
  const bottleId = uuidParam(params.bottleId);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guardWrites();
  await sharedRacks.withdraw(bottleId);
});
