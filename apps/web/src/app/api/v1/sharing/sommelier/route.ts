import { DomainError, SaveSommelierSharingSchema } from "@cellr/domain";
import { getFeatures } from "@/server/env";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/**
 * Whether my friends' sommelier may take my taste into account when they name me in a question. Its own consent,
 * apart from showing my taste profile to friends, and off until I turn it on. Part of the `sommelier_social`
 * feature: without it the route does not exist.
 */
export const GET = authed(async ({ ctx }) => {
  if (!getFeatures().sommelier_social) throw new DomainError("NOT_FOUND");
  return servicesFor(ctx).friends.sommelierSharing();
});

/** PUT { tasteForFriends?, cellarForFriends? } (at least one) → change it. Takes effect at the next question anyone asks; nothing is cached. */
export const PUT = authed(async ({ request, ctx }) => {
  if (!getFeatures().sommelier_social) throw new DomainError("NOT_FOUND");
  return servicesFor(ctx).friends.saveSommelierSharing(
    await readJson(request, SaveSommelierSharingSchema),
  );
});
