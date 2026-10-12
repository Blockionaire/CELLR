import { SaveMyValueSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { vintageId: string };

/** GET → the saved AI profile of this vintage and the household's own value, if any. */
export const GET = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).insights.get(uuidParam(params.vintageId)),
);

/** POST → asks the AI for a profile of this vintage (an estimate), keeps it, and returns it. */
export const POST = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).insights.generate(uuidParam(params.vintageId)),
);

/** PUT { myValueCents } → the household's own value per bottle (null clears it). */
export const PUT = authed<Params>(async ({ request, ctx, params }) => {
  const { myValueCents } = await readJson(request, SaveMyValueSchema);
  return servicesFor(ctx).insights.saveMyValue(uuidParam(params.vintageId), myValueCents);
});
