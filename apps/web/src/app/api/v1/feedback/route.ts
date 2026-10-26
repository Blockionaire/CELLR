import { SubmitFeedbackSchema } from "@cellr/domain";
import { authed, created, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** POST { category, message, location?, device? } → stores the signed-in person's beta feedback. */
export const POST = authed(async ({ request, ctx }) =>
  created(await servicesFor(ctx).feedback.submit(await readJson(request, SubmitFeedbackSchema))),
);
