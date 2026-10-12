import { SaveTastingSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** PUT { score?, descriptors?, note? } → "how was it?" for a bottle that has been opened (replaces your earlier answer). */
export const PUT = authed<Params>(async ({ request, ctx, params }) => {
  const input = await readJson(request, SaveTastingSchema);
  return servicesFor(ctx).cellar.saveTasting(uuidParam(params.id), input);
});

/** DELETE → takes back what you said about this bottle. */
export const DELETE = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).cellar.deleteTasting(uuidParam(params.id)),
);
