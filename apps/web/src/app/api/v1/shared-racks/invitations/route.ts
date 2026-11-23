import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/**
 * GET → { invitations }: the invitations to a shared rack that are waiting for ME (open and not expired), each with
 * the rack's name and who asked. Nothing else of a rack is shown before accepting.
 */
export const GET = authed(async ({ ctx }) => {
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guard();
  return sharedRacks.myInvitations();
});
