import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/** GET → { total }: the points I earned (for bottle photos, so far). */
export const GET = authed(async ({ ctx }) => ({ total: await servicesFor(ctx).library.points() }));
