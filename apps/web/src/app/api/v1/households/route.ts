import { CreateHouseholdSchema } from "@cellr/domain";
import { authed, created, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

export const GET = authed(async ({ ctx }) => servicesFor(ctx).households.listHouseholds());

/** POST { name, currency? } → creates a household with the caller as owner. */
export const POST = authed(async ({ request, ctx }) => {
  const input = await readJson(request, CreateHouseholdSchema);
  return created(await servicesFor(ctx).households.createHousehold(input));
});
