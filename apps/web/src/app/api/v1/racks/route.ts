import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/** Every storage unit with what sits in each spot, plus the bottles that have no place yet. */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).cellar.racks());
