import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/** GET → bottles being kept for a day that is coming up (or just passed). */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).insights.reminders());
