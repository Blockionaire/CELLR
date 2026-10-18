import { z } from "zod";
import { DomainError, RespondSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** POST { accept } → yes or no to a request someone sent me. */
export const POST = authed<Params>(async ({ request, ctx, params }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new DomainError("NOT_FOUND");
  const { accept } = await readJson(request, RespondSchema);
  return servicesFor(ctx).friends.respond(id.data, accept);
});
