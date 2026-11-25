import { SharedRackRenameSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** GET → one rack I am a member of (see ../route.ts). 404 for a rack I am not in, as for one that does not exist. */
export const GET = authed<Params>(async ({ ctx, params }) => {
  const id = uuidParam(params.id);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guard();
  return sharedRacks.rack(id);
});

/** PATCH { name } → the rack, renamed. Owners only (403 for a member, 404 for anyone else). */
export const PATCH = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guardWrites();
  const { name } = await readJson(request, SharedRackRenameSchema);
  return sharedRacks.rename(id, name);
});

/**
 * DELETE → the rack, ARCHIVED (a rack and its history are never deleted). Owners only. An archived rack is read-only,
 * except that bottles can still be taken out and people can still leave; POST ./restore puts it back.
 */
export const DELETE = authed<Params>(async ({ ctx, params }) => {
  const id = uuidParam(params.id);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guardWrites();
  return sharedRacks.setArchived(id, true);
});
