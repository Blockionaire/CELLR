import "server-only";
import type { DrinkNoticeKind, PushSubscriptionInput } from "@cellr/domain";

/** The person's own phones and the reminders they have had. Every method returns null when the table is missing. */
export interface PushRepository {
  add(subscription: PushSubscriptionInput): Promise<boolean | null>;
  remove(endpoint: string): Promise<boolean | null>;
  known(): Promise<Set<string> | null>;
  markKnown(
    notices: ReadonlyArray<{ vintageId: string; kind: DrinkNoticeKind }>,
  ): Promise<boolean | null>;
}
