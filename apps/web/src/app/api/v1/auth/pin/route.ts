import { PinSignInSchema } from "@cellr/domain";
import { open, readJson } from "@/server/http";
import { getAuthService } from "@/server/services";

/** POST { email, pin } → signs in with the PIN instead of an emailed code (cookies). */
export const POST = open(async ({ request }) => {
  const input = await readJson(request, PinSignInSchema);
  await (await getAuthService()).signInWithPin(input);
  return { ok: true };
});
