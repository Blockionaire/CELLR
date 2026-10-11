import { open } from "@/server/http";
import { getAuthService } from "@/server/services";

/** POST → ends this device's session. */
export const POST = open(async () => {
  await (await getAuthService()).signOut();
});
