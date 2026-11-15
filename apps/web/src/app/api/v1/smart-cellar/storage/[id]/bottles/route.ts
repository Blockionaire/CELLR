import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * GET → a place and every bottle in the cellar on a spot in it, each with its WHOLE spot (row, col and index; a
 * bottle from before depth is at index 1, and an index above 1 is never reported as 1). Read `unit.indexMeaning`
 * before treating an index as a position.
 */
export const GET = authed<Params>(async ({ ctx, params }) =>
  servicesFor(ctx).smartCellar.placements(uuidParam(params.id)),
);
