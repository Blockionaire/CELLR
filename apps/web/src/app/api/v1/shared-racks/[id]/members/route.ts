import { authed, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** GET → { members }: the people in the rack now, by name, with their role and how many bottles of theirs are in it. */
export const GET = authed<Params>(async ({ ctx, params }) => {
  const id = uuidParam(params.id);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guard();
  return sharedRacks.members(id);
});
