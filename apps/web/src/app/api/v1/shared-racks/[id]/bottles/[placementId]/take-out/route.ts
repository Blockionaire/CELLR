import { SharedRackTakeOutSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string; placementId: string };

/**
 * POST { from: spot } → { placementId, outcome: "taken_out" }: "I took this bottle out of the rack". Any member,
 * any bottle, only while it still stands where the caller saw it. The placement ends and the history names the taker
 * and the owner.
 *
 * IT IS NOT "CONSUMED": the bottle's own record is not touched at all. It shows in its owner's cellar without a
 * place, and what became of it is for the owner to say there. Works in an archived rack too.
 */
export const POST = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const placementId = uuidParam(params.placementId);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guardWrites();
  return sharedRacks.takeOut(id, placementId, await readJson(request, SharedRackTakeOutSchema));
});
