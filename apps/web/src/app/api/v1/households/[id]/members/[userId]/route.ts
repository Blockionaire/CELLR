import { z } from "zod";
import { DomainError } from "@cellr/domain";
import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/** DELETE → leave the household (your own id) or, as owner, remove a member. */
export const DELETE = authed<{ id: string; userId: string }>(async ({ ctx, params }) => {
  const ids = z.object({ id: z.uuid(), userId: z.uuid() }).safeParse(params);
  if (!ids.success) throw new DomainError("NOT_FOUND");
  await servicesFor(ctx).households.removeMember(ids.data.id, ids.data.userId);
});
