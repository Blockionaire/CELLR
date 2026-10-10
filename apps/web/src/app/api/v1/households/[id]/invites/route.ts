import { z } from "zod";
import { CreateInviteSchema, DomainError } from "@cellr/domain";
import { authed, created, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** POST { ttlHours?, maxUses? } → a new invite code. The code is shown once; only a hash is stored. */
export const POST = authed<{ id: string }>(async ({ request, ctx, params }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new DomainError("NOT_FOUND");
  const input = await readJson(request, CreateInviteSchema, { optional: true });
  return created(await servicesFor(ctx).households.createInvite(id.data, input));
});
