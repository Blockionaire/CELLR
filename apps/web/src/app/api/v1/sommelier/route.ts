import { AskSommelierSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

export const maxDuration = 60;

/** POST { messages } → the sommelier's answer about your cellar, with the bottles it points at. */
export const POST = authed(async ({ request, ctx }) =>
  servicesFor(ctx).sommelier.ask(await readJson(request, AskSommelierSchema)),
);
