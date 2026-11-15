import { authed } from "@/server/http";
import { servicesFor } from "@/server/services";

/**
 * GET → every place of the active household in the new terms: template, size, bottles per position, what an index
 * means, look, zones, capacity and occupancy, whether its arrangement is known, and what could not be read as stored.
 * The two-coordinate /api/v1/storage is unchanged.
 */
export const GET = authed(async ({ ctx }) => servicesFor(ctx).smartCellar.units());
