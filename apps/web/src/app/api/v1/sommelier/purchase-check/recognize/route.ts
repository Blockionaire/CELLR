import { DomainError, LABEL_TEXT_LIMITS } from "@cellr/domain";
import { authed, readForm } from "@/server/http";
import { LIMITS } from "@/server/ratelimit/service";
import { servicesFor } from "@/server/services";

export const maxDuration = 60;

/**
 * POST multipart { photo, labelText? } → Koopcheck, step 1: what wine the bottle in the shop is, to confirm or
 * correct. The photo is checked and read in memory and never kept; the answer may be "type it in".
 */
export const POST = authed(async ({ request, ctx }) => {
  const form = await readForm(request);
  const photo = form.get("photo");
  if (!(photo instanceof File)) throw new DomainError("VALIDATION");
  const labelText = form.get("labelText");
  const services = servicesFor(ctx);
  await services.limiter.enforce(LIMITS.uploads);
  return services.purchaseCheck.recognize({
    photo: new Uint8Array(await photo.arrayBuffer()),
    labelText: typeof labelText === "string" ? labelText.slice(0, LABEL_TEXT_LIMITS.chars) : null,
  });
});
