import { AttachPhotoSchema, DomainError } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { vintageId: string };

/**
 * PUT { imageId, side?, onlyIfEmpty? } → this label photo becomes the front (or back) photo of every bottle of the
 * wine. With onlyIfEmpty (back only) it is put on only when there is no back label yet: { attached: false } if there is.
 */
export const PUT = authed<Params>(async ({ request, ctx, params }) => {
  const { imageId, side, onlyIfEmpty } = await readJson(request, AttachPhotoSchema);
  return servicesFor(ctx).cellar.attachPhoto(uuidParam(params.vintageId), imageId, side, {
    onlyIfEmpty: onlyIfEmpty === true,
  });
});

/** DELETE ?side=front|back → takes that photo off the wine again (the front, unless said otherwise). */
export const DELETE = authed<Params>(async ({ request, ctx, params }) => {
  const side = new URL(request.url).searchParams.get("side") ?? "front";
  if (side !== "front" && side !== "back") throw new DomainError("VALIDATION");
  return servicesFor(ctx).cellar.removePhoto(uuidParam(params.vintageId), side);
});
