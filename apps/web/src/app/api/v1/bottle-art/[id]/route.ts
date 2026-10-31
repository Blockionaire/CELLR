import { authed, imageResponse, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * GET → a wine's published 2D bottle picture, read as the viewer: the storage policy lets it through only while it is
 * the published picture of a wine they can see right now. A catalogue wine's picture is the same for everyone and its
 * id changes with every new picture, so it may be kept; a household's own picture is never stored by the browser, so
 * leaving the household (or the picture being taken off) takes it away at once.
 */
export const GET = authed<Params>(async ({ ctx, params }) => {
  const file = await servicesFor(ctx).library.artFile(uuidParam(params.id));
  return imageResponse(file.bytes, {
    type: file.type === "image/png" ? "image/png" : "image/jpeg",
    noStore: !file.shared,
  });
});
