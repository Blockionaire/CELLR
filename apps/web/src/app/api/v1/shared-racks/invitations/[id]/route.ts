import { SharedRackRespondSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * POST { accept } → { outcome: "accepted" | "declined", rackId }: yes or no to an invitation that was sent to ME.
 * Accepting again answers the same (a repeat is safe). 404 for an invitation that is not mine or does not exist;
 * 409 when it expired, was cancelled or declined, or the rack is full or no longer in use.
 */
export const POST = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guardWrites();
  const { accept } = await readJson(request, SharedRackRespondSchema);
  return sharedRacks.respond(id, accept);
});

/** DELETE → 204: an owner of the rack takes back an invitation that is still open. 404 for anyone not in that rack. */
export const DELETE = authed<Params>(async ({ ctx, params }) => {
  const id = uuidParam(params.id);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guardWrites();
  await sharedRacks.cancelInvitation(id);
});
