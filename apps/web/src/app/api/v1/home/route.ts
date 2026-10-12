import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/** The cellar at a glance: totals, space, what was added and opened lately. */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).cellar.home());
