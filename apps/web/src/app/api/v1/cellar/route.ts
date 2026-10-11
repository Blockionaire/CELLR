import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/** What is in the cellar right now: one entry per wine vintage, with its bottle count. */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).cellar.inventory());
