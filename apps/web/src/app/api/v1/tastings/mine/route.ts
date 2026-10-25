import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/** GET → my tasting journal: the signed-in person's own tastings in their active household, with a summary. */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).cellar.journal());
