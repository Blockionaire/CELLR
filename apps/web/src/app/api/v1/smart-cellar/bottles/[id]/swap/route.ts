import { SmartSwapSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * POST { with: bottleId, expected: { self: spot, other: spot } } → { self, other } (Smart Cellar 3D, sprint 4).
 * The two bottles trade their whole spots in one database call (swap_bottles_v2), only while each is still on the
 * spot the caller saw. Undo is the same call with the two new spots. Refusals as for a move; two bottles of one
 * compartment of counters do not trade (422).
 */
export const POST = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const smartCellar = servicesFor(ctx).smartCellar;
  smartCellar.guardPlacement();
  const swap = await readJson(request, SmartSwapSchema);
  return smartCellar.swapBottle(id, swap);
});
