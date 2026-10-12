import { CreateStorageSchema } from "@cellr/domain";
import { authed, created, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** Storage units (fridge, rack, cabinet…) with how many spots are free. */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).cellar.storage());

/** POST { label, kind?, rows, cols } → a new storage unit. */
export const POST = authed(async ({ request, ctx }) => {
  const input = await readJson(request, CreateStorageSchema);
  return created(await servicesFor(ctx).cellar.createStorage(input));
});
