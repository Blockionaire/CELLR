import { SharedRackRoleSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string; userId: string };

/**
 * PATCH { role: "owner" | "member" } → { userId, role }. Owners only. The owner role moves only like this,
 * explicitly; the last owner cannot be made a member (409: hand the role over first).
 */
export const PATCH = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const userId = uuidParam(params.userId);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guardWrites();
  const { role } = await readJson(request, SharedRackRoleSchema);
  return sharedRacks.setRole(id, userId, role);
});

/**
 * DELETE → 204: an owner removes someone else from the rack. Their access ends at once. Their bottles are not
 * touched: they stay theirs, and stay where they stand until someone records taking them out.
 * Removing yourself is leaving (POST ../../leave): 422.
 */
export const DELETE = authed<Params>(async ({ ctx, params }) => {
  const id = uuidParam(params.id);
  const userId = uuidParam(params.userId);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guardWrites();
  await sharedRacks.removeMember(id, userId);
});
