import { DomainError } from "@cellr/domain";
import { z } from "zod";
import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

const WineIds = z.array(z.uuid()).min(1).max(100);

/**
 * GET ?wine=<id>[&wine=<id>…] → where I stand with each wine's bottle photos: eligible, submitted, rejected or published,
 * and the points the ledger holds for me for it. Only my own contributions count; only wines I can see come back.
 * `items: null`: not known (the database step is not taken yet), and the app asks as before.
 */
export const GET = authed(async ({ request, ctx }) => {
  const ids = WineIds.safeParse(new URL(request.url).searchParams.getAll("wine"));
  if (!ids.success) throw new DomainError("VALIDATION");
  return { items: await servicesFor(ctx).library.status(ids.data) };
});
