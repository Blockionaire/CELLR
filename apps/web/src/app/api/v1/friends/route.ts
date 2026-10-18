import { SendRequestSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** GET → my account name and friend code, my friends, and the requests both ways. */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).friends.overview());

/** POST { userId } → ask them to be friends (or accept, when they had already asked me). */
export const POST = authed(async ({ request, ctx }) => {
  const { userId } = await readJson(request, SendRequestSchema);
  return servicesFor(ctx).friends.request(userId);
});
