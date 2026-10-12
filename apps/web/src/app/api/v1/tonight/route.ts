import { TonightRequestSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** POST { dish?, occasion? } → up to three bottles from your cellar for tonight, each with the bottle to open and why. */
export const POST = authed(async ({ request, ctx }) => {
  const input = await readJson(request, TonightRequestSchema);
  return servicesFor(ctx).cellar.tonight(input);
});
