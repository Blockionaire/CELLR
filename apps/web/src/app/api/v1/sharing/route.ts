import { SaveSharingSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** GET → who sees my ratings, taste profile and cellar: all friends, nobody, or the ones I chose. */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).friends.sharing());

/** PUT { modes, picks } → change that. */
export const PUT = authed(async ({ request, ctx }) =>
  servicesFor(ctx).friends.saveSharing(await readJson(request, SaveSharingSchema)),
);
