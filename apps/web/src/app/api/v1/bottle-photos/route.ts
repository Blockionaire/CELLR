import { BOTTLE_PHOTO_MAX, BottlePhotoFieldsSchema, DomainError } from "@cellr/domain";
import { authed, readForm } from "@/server/http";
import { LIMITS } from "@/server/ratelimit/service";
import { servicesFor } from "@/server/services";

/**
 * POST multipart { photo (1 to 3 times), vintageId, consent=true } → one contribution of photos of a bottle for the
 * library, then what it earned and my points. Only with the explicit yes (one for the whole contribution); the photos
 * are kept where only the admin can see them.
 */
export const POST = authed(async ({ request, ctx }) => {
  // prepared photos are a few hundred KB each: three fit in one ordinary upload
  const form = await readForm(request);
  const photos = form.getAll("photo").filter((p): p is File => p instanceof File && p.size > 0);
  if (photos.length < 1 || photos.length > BOTTLE_PHOTO_MAX) throw new DomainError("VALIDATION");
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
    await Promise.all(photos.map(async (p) => new Uint8Array(await p.arrayBuffer()))),
  );
});
