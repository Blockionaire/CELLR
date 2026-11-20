import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * GET → { bottleId, inCellar, spot: { locationId, row, col, index } | null } (Smart Cellar 3D, sprint 4).
 * Where ONE bottle of the active household is now, read from the database as the signed-in person (row-level
 * security), never from a cache: what the placement screen asks after a move, swap or take-off whose answer was lost.
 * `spot` is null for a bottle without a place (and for one no longer in the cellar: `inCellar` false).
 *
 * Read-only. 404 where placement is not switched on, and for a bottle of another household or none.
 */
export const GET = authed<Params>(async ({ ctx, params }) => {
  const id = uuidParam(params.id);
  return servicesFor(ctx).smartCellar.bottleSpot(id);
});
