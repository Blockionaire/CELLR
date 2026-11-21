import { AdviceIntentSchema } from "@cellr/domain";
import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * GET ?intent=store|serve → where this bottle could go, ranked and explained (Smart Cellar 3D, sprint 5; ADR-009).
 * Read-only: nothing is written or kept; acting on a recommendation is the Sprint 4 move. Every fact (the bottle, the
 * household's places, every placed bottle) is read on the server as the signed-in person (row-level security); the
 * caller sends only the bottle and the intent.
 *
 * 404 where advice is not switched on (the advice gate and the placement gate), and for a bottle of another household
 * or none. 422 for a missing or unknown intent. A database without the Smart Cellar step answers as the rest of the
 * Smart Cellar API does ("not set up"), never as an empty cellar.
 */
export const GET = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const intent = AdviceIntentSchema.parse(new URL(request.url).searchParams.get("intent"));
  return servicesFor(ctx).smartCellar.advise(id, intent);
});
