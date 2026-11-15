import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/**
 * GET → what this server offers of the Smart Cellar API (sprint 1C): reads, writes, whether the database has the
 * Smart Cellar step, and the catalogue, look and export versions. 404 where the API is not switched on.
 */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).smartCellar.capabilities());
