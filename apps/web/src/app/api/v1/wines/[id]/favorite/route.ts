import { SetFavoriteSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** PUT { favorite: boolean } → stars or un-stars the wine for the signed-in person only. */
export const PUT = authed<Params>(async ({ request, ctx, params }) => {
  const { favorite } = await readJson(request, SetFavoriteSchema);
  return servicesFor(ctx).cellar.setFavorite(uuidParam(params.id), favorite);
});
