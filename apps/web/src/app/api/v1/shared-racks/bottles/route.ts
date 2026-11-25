import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/**
 * GET → { bottles }: the bottles of MY OWN households that stand in a shared rack, for my own cellar's screens (such
 * a bottle has no place in my cellar). The rack and the spot are named only while I am a member of that rack;
 * otherwise `hasAccess` is false and the bottle can only be withdrawn (DELETE ./:bottleId) or used at home.
 */
export const GET = authed(async ({ ctx }) => {
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guard();
  return sharedRacks.myBottles();
});
