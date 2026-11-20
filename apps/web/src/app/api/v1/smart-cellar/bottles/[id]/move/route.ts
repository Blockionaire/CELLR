import { SmartMoveSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * POST { from: spot | null, to: spot | null } → { bottleId, outcome: "moved" | "already_there", from, to }
 * (Smart Cellar 3D, sprint 4). A spot is { locationId, row, col, index }, whole. `from` is where the caller SAW the
 * bottle; the move happens, in one conditional database statement, only while it is still there.
 *
 * Refused: 404 where placement is not switched on (or no such bottle or place for this household), 403 where it is
 * on but does not write here (production, a database that is not a test one), 409 when the bottle is not where it
 * was seen, the target is taken, behind a bottle, past index 1 while depth is off, or in a place whose arrangement
 * is not known, 422 for a spot that is not one of the place's. Nothing changes in any of these.
 * A repeat of a move that already happened (its first answer was lost) answers "already_there".
 */
export const POST = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const smartCellar = servicesFor(ctx).smartCellar;
  smartCellar.guardPlacement();
  const move = await readJson(request, SmartMoveSchema);
  return smartCellar.moveBottle(id, move);
});
