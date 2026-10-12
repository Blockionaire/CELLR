import { DomainError, IMAGE_SIDES, type ImageSide } from "@cellr/domain";
import { authed, created, readForm } from "@/server/http";
import { LIMITS } from "@/server/ratelimit/service";
import { servicesFor } from "@/server/services";

const bytesOf = async (value: FormDataEntryValue | null): Promise<Uint8Array | null> =>
  value instanceof File ? new Uint8Array(await value.arrayBuffer()) : null;

/**
 * POST multipart { photo, thumb?, side?, blurColor? } → keeps a label photo for the household.
 * The browser sends a photo of at most ~1600 px and a small copy; the server cleans and checks both.
 */
export const POST = authed(async ({ request, ctx }) => {
  const form = await readForm(request);
  const photo = await bytesOf(form.get("photo"));
  if (!photo) throw new DomainError("VALIDATION");
  const side = String(form.get("side") ?? "front");
  if (!IMAGE_SIDES.includes(side as ImageSide)) throw new DomainError("VALIDATION");
  const services = servicesFor(ctx);
  await services.limiter.enforce(LIMITS.uploads);
  return created(
    await services.images.upload({
      side: side as ImageSide,
      photo,
      thumb: await bytesOf(form.get("thumb")),
      blurColor: typeof form.get("blurColor") === "string" ? String(form.get("blurColor")) : null,
    }),
  );
});
