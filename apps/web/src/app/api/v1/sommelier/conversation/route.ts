import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/** GET → { conversation } the conversation to continue (yours, in your active household, used in the last 7 days). */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).sommelierChat.current());

/** DELETE → 204: a new conversation. The kept one is deleted; ratings of its answers stay. */
export const DELETE = authed(async ({ ctx }) => {
  await servicesFor(ctx).sommelierChat.clear();
});
