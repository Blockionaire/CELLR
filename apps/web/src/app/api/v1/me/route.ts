import { DeleteAccountSchema, UpdateProfileSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { getAuthService, servicesFor } from "@/server/services";

/** GET → who am I, my households and which one is active. */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).households.me());

/** PATCH { displayName?, locale? } → update my profile. */
export const PATCH = authed(async ({ request, ctx }) => {
  const patch = await readJson(request, UpdateProfileSchema);
  return servicesFor(ctx).households.updateProfile(patch);
});

/** DELETE { email } → deletes my account. I must type my own email; households only I was in go with me. */
export const DELETE = authed(async ({ request, ctx }) => {
  const { email } = await readJson(request, DeleteAccountSchema);
  await servicesFor(ctx).account.delete(email);
  // The sign-in is gone but the session cookie would still pass for a while: clear it, so the next page is the
  // sign-in page and not a half-empty app. (The account is already deleted; if this fails, there is nothing to undo.)
  await (await getAuthService()).signOut().catch(() => {});
});
