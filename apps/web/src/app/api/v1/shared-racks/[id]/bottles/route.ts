import { SharedRackBottlesQuerySchema, SharedRackPlaceSchema } from "@cellr/domain";
import { authed, created, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * GET ?owner=<userId> → { rack, bottles }: the rack and every bottle in it as every member sees them. Per bottle:
 * its placement id (the handle for moving and taking out), its whole spot, its owner by name, and the label: producer,
 * wine, year, type, region, country and format. Never a price, purchase facts, notes, ratings, photos, the household
 * or a catalogue id; the bottle's own id only for its own household. Optionally one owner's bottles.
 */
export const GET = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guard();
  const { owner } = SharedRackBottlesQuerySchema.parse({
    owner: new URL(request.url).searchParams.get("owner"),
  });
  return sharedRacks.bottles(id, owner);
});

/**
 * POST { bottleId, to: { row, col, index } } → 201 { placementId, outcome: "placed" | "already_there", to }.
 * Puts a bottle OF MY OWN HOUSEHOLD on a free spot; I am its owner in the rack. The body has no owner and no actor,
 * and anything else in it is refused (422). A bottle that stood in a private place of mine leaves it in the same
 * transaction. Refused: a bottle that is not mine or does not exist (404, the same answer), a taken spot, a bottle
 * that is no longer in the cellar or already in a shared rack, an archived rack (409), a spot that is not the
 * rack's (422).
 */
export const POST = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guardWrites();
  return created(await sharedRacks.place(id, await readJson(request, SharedRackPlaceSchema)));
});
