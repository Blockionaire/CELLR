import { SetHandleSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** PUT { handle } → my account name, the one friends find me by. 409 when it is taken. */
export const PUT = authed(async ({ request, ctx }) => {
  const { handle } = await readJson(request, SetHandleSchema);
  return servicesFor(ctx).friends.setHandle(handle);
});
