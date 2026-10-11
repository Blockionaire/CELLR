import { TrackEventSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** POST { name, props?, householdId? } → records a product event (fire and forget; 204). */
export const POST = authed(async ({ request, ctx }) => {
  const event = await readJson(request, TrackEventSchema);
  await servicesFor(ctx).analytics.track(event);
});
