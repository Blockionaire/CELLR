import { DomainError } from "@cellr/domain";
import { authed, readForm, uuidParam } from "@/server/http";
import { LIMITS } from "@/server/ratelimit/service";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * PUT multipart { texture } → the straightened picture of just the label, made on the phone from the photo's
 * four corners. It replaces any earlier one. The server cleans and checks it like any photo.
 */
export const PUT = authed<Params>(async ({ request, ctx, params }) => {
  const form = await readForm(request);
  const file = form.get("texture");
  if (!(file instanceof File)) throw new DomainError("VALIDATION");
  const services = servicesFor(ctx);
  await services.limiter.enforce(LIMITS.uploads);
  return services.images.setTexture(uuidParam(params.id), new Uint8Array(await file.arrayBuffer()));
});

/** DELETE → the bottle goes back to wearing the whole photo. */
export const DELETE = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).images.removeTexture(uuidParam(params.id)),
);
