import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/** DELETE → "not now" for Home's bottle-photo invitation: none for 30 days, on every device. */
export const DELETE = authed(async ({ ctx }) => {
  await servicesFor(ctx).library.dismissInvite();
});
