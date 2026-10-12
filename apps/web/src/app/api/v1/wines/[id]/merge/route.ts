import { MergeWineSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/**
 * POST { intoWineId, year? } → folds this wine (one the household entered itself) into another: its bottles,
 * ratings, wish and stars move over and it disappears. Answers where the vintage in `year` ended up.
 */
export const POST = authed<Params>(async ({ request, ctx, params }) =>
  servicesFor(ctx).cellar.mergeWine(uuidParam(params.id), await readJson(request, MergeWineSchema)),
);
