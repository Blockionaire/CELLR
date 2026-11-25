import { SharedRackInviteSchema } from "@cellr/domain";
import { authed, created, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** GET → { invitations }: everyone invited to this rack and what became of it. Owners only (403 for a member). */
export const GET = authed<Params>(async ({ ctx, params }) => {
  const id = uuidParam(params.id);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guard();
  return sharedRacks.invitations(id);
});

/**
 * POST { userId } → 201 { invitationId, outcome: "invited" | "already_invited" }. Owners only.
 * `userId` is an existing person, found with the existing exact search (GET /api/v1/friends/search?q=@name or a
 * friend code): there is no other lookup, and being friends is not needed. Refused: yourself (422), nobody by that
 * id (404), someone already in the rack, someone who declined in the last week, a full rack (409).
 */
export const POST = authed<Params>(async ({ request, ctx, params }) => {
  const id = uuidParam(params.id);
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guardWrites();
  const { userId } = await readJson(request, SharedRackInviteSchema);
  return created(await sharedRacks.invite(id, userId));
});
