import { SetPinSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** GET → is there a sign-in PIN (and can there be one yet)? */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).pin.status());

/** PUT { pin } → set or change my sign-in PIN. */
export const PUT = authed(async ({ request, ctx }) => {
  const { pin } = await readJson(request, SetPinSchema);
  return servicesFor(ctx).pin.set(pin);
});

/** DELETE → no PIN any more: sign in with an emailed code. */
export const DELETE = authed(async ({ ctx }) => servicesFor(ctx).pin.remove());
