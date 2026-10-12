import { UpdatePurchaseSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { vintageId: string };

/** PATCH { priceCents?, purchasedAt?, purchasedFrom? } → applies to every bottle of the vintage in the cellar. */
export const PATCH = authed<Params>(async ({ request, ctx, params }) => {
  const patch = await readJson(request, UpdatePurchaseSchema);
  return servicesFor(ctx).cellar.updatePurchase(uuidParam(params.vintageId), patch);
});
