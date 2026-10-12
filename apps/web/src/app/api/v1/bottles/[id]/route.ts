import { BottleActionSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** PATCH { action: "open" | "remove" | "move" | "restore", to? } → the bottle, and where it was before (for Undo). */
export const PATCH = authed<Params>(async ({ request, ctx, params }) => {
  const action = await readJson(request, BottleActionSchema);
  return servicesFor(ctx).cellar.bottleAction(uuidParam(params.id), action);
});
