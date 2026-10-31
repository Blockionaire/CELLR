import { BottlePhotoFieldsSchema, DomainError } from "@cellr/domain";
import { authed, readForm } from "@/server/http";
import { LIMITS } from "@/server/ratelimit/service";
import { servicesFor } from "@/server/services";

/**
 * POST multipart { photo, vintageId, consent=true } → a photo of a whole bottle for the library, then what it earned
 * and my points. Only with the explicit yes; the photo is kept where only the admin can see it.
 */
export const POST = authed(async ({ request, ctx }) => {
  const form = await readForm(request);
  const photo = form.get("photo");
  if (!(photo instanceof File)) throw new DomainError("VALIDATION");
  const fields = BottlePhotoFieldsSchema.safeParse({
    vintageId: form.get("vintageId"),
    consent: form.get("consent"),
  });
  if (!fields.success)
    throw new DomainError(
      "VALIDATION",
      form.get("consent") === "true" ? undefined : "Tick the box to let CELLR use your photo.",
    );
  const services = servicesFor(ctx);
  await services.limiter.enforce(LIMITS.uploads);
  return services.library.submit(
    fields.data.vintageId,
    true,
    new Uint8Array(await photo.arrayBuffer()),
  );
});
