import { UpdateWineSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** PATCH { name?, region?, countryCode?, appellation? } → corrects a wine the household added itself. */
export const PATCH = authed<Params>(async ({ request, ctx, params }) => {
  const patch = await readJson(request, UpdateWineSchema);
  return servicesFor(ctx).cellar.updateWine(uuidParam(params.id), patch);
});
