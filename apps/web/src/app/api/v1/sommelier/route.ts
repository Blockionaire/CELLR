import { AskSommelierSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

export const maxDuration = 60;

/**
 * POST { messages, questionId? } → the sommelier's answer about your cellar, with the bottles it points at. With a
 * `questionId` (the general chat) the question and its answer are kept in your conversation and the reply says
 * where (`saved`); the same id again gets the kept answer back, without asking the model twice.
 */
export const POST = authed(async ({ request, ctx }) =>
  servicesFor(ctx).sommelierChat.ask(await readJson(request, AskSommelierSchema)),
);
