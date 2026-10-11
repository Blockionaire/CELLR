import { JoinHouseholdSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** POST { code } → joins a household with an invite code. */
export const POST = authed(async ({ request, ctx }) => {
  const { code } = await readJson(request, JoinHouseholdSchema);
  return servicesFor(ctx).households.join(code);
});
