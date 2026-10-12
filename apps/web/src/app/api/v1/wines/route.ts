import { CreateWineSchema } from "@cellr/domain";
import { authed, created, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** The wines this household can choose from (its own, plus the shared catalogue). */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).cellar.wines());

/** POST { producer, name, type, countryCode?, region? } → the wine (existing one if it is already there). */
export const POST = authed(async ({ request, ctx }) => {
  const input = await readJson(request, CreateWineSchema);
  return created(await servicesFor(ctx).cellar.createWine(input));
});
