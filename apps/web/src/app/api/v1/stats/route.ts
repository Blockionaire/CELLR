import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/** GET → the cellar in numbers: what is in it, what it cost and is worth, when it is ready, what was drunk. */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).stats.overview());
