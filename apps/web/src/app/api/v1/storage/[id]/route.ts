import { UpdateStorageSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** PATCH { label?, kind?, rows?, cols? } → renames or resizes a place (never below bottles still in it). */
export const PATCH = authed<Params>(async ({ request, ctx, params }) => {
  const patch = await readJson(request, UpdateStorageSchema);
  return servicesFor(ctx).cellar.updateStorage(uuidParam(params.id), patch);
});

/** DELETE → removes an empty place. Owner only. */
export const DELETE = authed<Params>(async ({ ctx, params }) => {
  await servicesFor(ctx).cellar.deleteStorage(uuidParam(params.id));
});
