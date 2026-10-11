import "server-only";
import type { Db } from "@/server/db/clients";
import type { Json } from "@/server/db/database.types";
import { mapDbError } from "@/server/db/errors";
import type { TrackEvent } from "@cellr/domain";

export interface AnalyticsRepository {
  record(event: TrackEvent): Promise<void>;
}

/** Insert-only: clients can write events but never read them back, not even their own. */
export function createAnalyticsRepository(db: Db): AnalyticsRepository {
  return {
    async record({ name, props, householdId }) {
      const { error } = await db.from("analytics_events").insert({
        name,
        props: props as NonNullable<Json>,
        ...(householdId ? { household_id: householdId } : {}),
      });
      if (error) throw mapDbError(error);
    },
  };
}
