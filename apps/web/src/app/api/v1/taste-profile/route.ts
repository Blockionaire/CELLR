import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/** GET → my taste profile (my own tastings in my active household, and my own answers). */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).taste.profile());
