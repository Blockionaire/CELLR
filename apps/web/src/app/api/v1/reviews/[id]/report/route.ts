import { ReportReviewSchema } from "@cellr/domain";
import { authed, readJson, uuidParam } from "@/server/http";
import { servicesFor } from "@/server/services";

type Params = { id: string };

/** POST { reason, detail? } → reports someone else's review to the moderators (once per person). */
export const POST = authed<Params>(async ({ request, ctx, params }) => {
  const input = await readJson(request, ReportReviewSchema);
  return servicesFor(ctx).ratings.report(uuidParam(params.id), input.reason, input.detail);
});
