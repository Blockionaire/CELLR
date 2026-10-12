import { AttachPhotoSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { vintageId: string };

/** PUT { imageId } → this label photo becomes the photo of every bottle of the wine. */
export const PUT = authed<Params>(async ({ request, ctx, params }) => {
  const { imageId } = await readJson(request, AttachPhotoSchema);
  return servicesFor(ctx).cellar.attachPhoto(uuidParam(params.vintageId), imageId);
});

/** DELETE → takes the photo off the wine again. */
export const DELETE = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).cellar.removePhoto(uuidParam(params.vintageId)),
);
