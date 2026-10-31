import { authed, imageResponse, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * GET → a wine's published 2D bottle picture (the library's, shared by everyone who owns the wine). A replaced
 * picture gets a new id, so this address can be kept for good; one that is no longer published is "not found".
 */
export const GET = authed<Params>(async ({ ctx, params }) => {
  const file = await servicesFor(ctx).library.artFile(uuidParam(params.id));
  return imageResponse(file.bytes, {
    type: file.type === "image/png" ? "image/png" : "image/jpeg",
  });
});
