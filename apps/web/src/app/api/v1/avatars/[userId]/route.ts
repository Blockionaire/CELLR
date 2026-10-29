import { authed, imageResponse, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { userId: string };

/**
 * GET → someone's profile photo, for themselves and the people they share a household with; anyone else gets "not
 * found". The address carries the photo's own name (?v=…), so it can be kept for good.
 */
export const GET = authed<Params>(async ({ ctx, params }) =>
  imageResponse(await servicesFor(ctx).avatars.file(uuidParam(params.userId))),
);
