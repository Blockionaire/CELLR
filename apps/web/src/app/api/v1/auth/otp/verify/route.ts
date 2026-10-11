import { OtpVerifySchema } from "@cellr/domain";
import { open, readJson } from "@/server/http";
import { getAuthService } from "@/server/services";

/** POST { email, code } → verifies the code and starts the session (cookies). */
export const POST = open(async ({ request }) => {
  const input = await readJson(request, OtpVerifySchema);
  await (await getAuthService()).verifyCode(input);
  return { ok: true };
});
