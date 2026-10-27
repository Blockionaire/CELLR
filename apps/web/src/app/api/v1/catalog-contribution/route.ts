import { CatalogContributionSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** GET → whether catalogue learning is on, and my own choice. */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).contribution.get());

/** PUT { contribute } → my choice (saying no also takes back what I contributed). */
export const PUT = authed(async ({ request, ctx }) => {
  const { contribute } = await readJson(request, CatalogContributionSchema);
  return servicesFor(ctx).contribution.set(contribute);
});
