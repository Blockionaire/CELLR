import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/** POST → the recommendations I have now seen stop counting as new. */
export const POST = authed(async ({ ctx }) => servicesFor(ctx).friends.markSeen());
