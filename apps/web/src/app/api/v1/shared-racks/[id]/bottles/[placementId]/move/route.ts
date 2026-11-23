import { SharedRackMoveSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string; placementId: string };

/**
 * POST { from: spot, to: spot } → { placementId, outcome: "moved" | "already_there", from, to }. A spot is
 * { row, col, index }, whole. `from` is where the caller SAW the bottle: it is moved, to a free spot of the same
 * rack, only while it is still there. Any member, any bottle; whose bottle it is does not change.
 *
 * Refused, nothing changed: 409 when the bottle is not where it was seen, was taken out meanwhile, the target is
 * taken, or the rack is archived; 422 for a spot that is not the rack's; 404 for a rack I am not in.
 * A repeat of a move that already happened answers "already_there".
 */
export const POST = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const placementId = uuidParam(params.placementId);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guardWrites();
  return sharedRacks.move(id, placementId, await readJson(request, SharedRackMoveSchema));
});
