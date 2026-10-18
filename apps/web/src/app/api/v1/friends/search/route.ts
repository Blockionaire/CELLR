import { FindPersonSchema } from "@cellr/domain";
import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/** GET ?q=@name or a friend code → that one person, or nobody. No browsing, no partial matches. */
export const GET = authed(async ({ request, ctx }) => {
  const { q } = FindPersonSchema.parse({ q: new URL(request.url).searchParams.get("q") ?? "" });
  return servicesFor(ctx).friends.find(q);
});
