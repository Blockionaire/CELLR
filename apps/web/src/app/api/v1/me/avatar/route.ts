import { DomainError } from "@cellr/domain";
import { authed, readForm } from "@/server/http";
import { LIMITS } from "@/server/ratelimit/service";
import { servicesFor } from "@/server/services";

/**
 * PUT multipart { photo } → my new profile photo (a small square JPEG made in the browser), then who I am now.
 * DELETE → back to my initials. Only ever my own: the storage policies allow nothing else.
 */
export const PUT = authed(async ({ request, ctx }) => {
  const form = await readForm(request);
  const photo = form.get("photo");
  if (!(photo instanceof File)) throw new DomainError("VALIDATION");
  const services = servicesFor(ctx);
  await services.limiter.enforce(LIMITS.uploads);
  await services.avatars.set(new Uint8Array(await photo.arrayBuffer()));
  return services.households.me();
});

export const DELETE = authed(async ({ ctx }) => {
  const services = servicesFor(ctx);
  await services.avatars.remove();
  return services.households.me();
});
