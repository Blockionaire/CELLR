import { RateSommelierAnswerSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** PUT { messageId, rating: "positive" | "negative" | null } → { rating }: rate one of your answers, or take it back. */
export const PUT = authed(async ({ request, ctx }) =>
  servicesFor(ctx).sommelierChat.rate(await readJson(request, RateSommelierAnswerSchema)),
);
