import { PushEndpointSchema, PushSubscriptionSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** GET → can reminders be switched on here, and the key to subscribe with. */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).push.status());

/** POST { endpoint, keys: { p256dh, auth } } → this phone gets "a wine is at its best" reminders. */
export const POST = authed(async ({ request, ctx }) =>
  servicesFor(ctx).push.subscribe(await readJson(request, PushSubscriptionSchema)),
);

/** DELETE ?endpoint=… → this phone no longer gets them. */
export const DELETE = authed(async ({ request, ctx }) => {
  const { endpoint } = PushEndpointSchema.parse({
    endpoint: new URL(request.url).searchParams.get("endpoint") ?? "",
  });
  return servicesFor(ctx).push.unsubscribe(endpoint);
});
