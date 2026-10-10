import { SetActiveHouseholdSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** PUT { householdId } → makes that household the active one. */
export const PUT = authed(async ({ request, ctx }) => {
  const { householdId } = await readJson(request, SetActiveHouseholdSchema);
  return servicesFor(ctx).households.setActiveHousehold(householdId);
});
