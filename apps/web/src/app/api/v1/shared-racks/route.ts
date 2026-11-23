import { SharedRackCreateSchema } from "@cellr/domain";
import { authed, created, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/**
 * GET ?archived=1 → { version, writes, depthPlacement, racks } (Shared racks, ADR-010): the racks I am a member of,
 * each in the terms of a place (template, size, look, capacity and occupancy) with my role and what I may do.
 * Archived ones only when asked. 404 where shared racks are not switched on (lib/shared-racks-gate.ts).
 */
export const GET = authed(async ({ request, ctx }) => {
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guard();
  return sharedRacks.list(new URL(request.url).searchParams.get("archived") === "1");
});

/**
 * POST { name, structure: { template, rows, cols, cellCapacity, zones: [] }, appearance } → 201, the new rack.
 * Whoever makes it is its first owner. The template decides the kind and what an index means. Refused: anything the
 * catalogue does not allow and temperature zones (422), more than one bottle per position (409: switched off), too
 * many racks (409). 403 where this deployment does not write.
 */
export const POST = authed(async ({ request, ctx }) => {
  const sharedRacks = servicesFor(ctx).sharedRacks;
  sharedRacks.guardWrites();
  return created(await sharedRacks.create(await readJson(request, SharedRackCreateSchema)));
});
