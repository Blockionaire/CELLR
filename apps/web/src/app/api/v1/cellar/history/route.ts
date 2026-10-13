import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/** GET → bottles that left the cellar (opened, given away, removed), newest first. Put one back with PATCH /bottles/{id}. */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).cellar.history());
