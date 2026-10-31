import { authed, imageResponse, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { userId: string };

/**
 * GET → someone's profile photo, for themselves and the people they share a household with; anyone else gets "not
 * found". Never cached: who may see it can change (someone leaves the household, another account signs in on the
 * same browser), so every showing goes through the check again.
 */
export const GET = authed<Params>(async ({ ctx, params }) =>
  imageResponse(await servicesFor(ctx).avatars.file(uuidParam(params.userId)), { noStore: true }),
);
