import { UpdateProfileSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** GET → who am I, my households and which one is active. */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).households.me());

/** PATCH { displayName?, locale? } → update my profile. */
export const PATCH = authed(async ({ request, ctx }) => {
  const patch = await readJson(request, UpdateProfileSchema);
  return servicesFor(ctx).households.updateProfile(patch);
});
