import { OtpRequestSchema } from "@cellr/domain";
import { open, readJson } from "@/server/http";
import { getAuthService } from "@/server/services";

/** POST { email } → sends a 6-digit sign-in code. */
export const POST = open(async ({ request }) => {
  const input = await readJson(request, OtpRequestSchema);
  await (await getAuthService()).requestCode(input);
  return { ok: true };
});
