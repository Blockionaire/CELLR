import type { FriendsView, PersonCard, RecommendationsView } from "@cellr/domain";

/**
 * What friends are waiting on, or have sent, for Home. One list, so nothing hides behind something else:
 * requests that need an answer come first (actionable), then wines recommended and not seen yet (informational).
 * A new kind (for instance a request to rate a wine, once that exists) is one more variant here.
 */
export type FriendActivityItem =
  | {
      kind: "invite";
      key: string;
      actionable: true;
      from: PersonCard;
      friendshipId: string;
      since: string;
    }
  | {
      kind: "recommendation";
      key: string;
      actionable: false;
      from: PersonCard;
      wine: string;
      since: string;
    };

export interface FriendActivity {
  items: FriendActivityItem[];
  /** People waiting for an answer. */
  requests: number;
  /** Recommendations not seen yet. */
  recommendations: number;
}

export function buildFriendActivity(
  friends: Pick<FriendsView, "ready" | "incoming"> | undefined,
  recommendations: Pick<RecommendationsView, "ready" | "items"> | undefined,
): FriendActivity {
  const invites: FriendActivityItem[] =
    friends?.ready === false
      ? []
      : (friends?.incoming ?? [])
          .filter((f) => f.status === "pending" && f.direction === "incoming")
          .map((f) => ({
            kind: "invite" as const,
            key: `invite:${f.friendshipId}`,
            actionable: true as const,
            from: f,
            friendshipId: f.friendshipId,
            since: f.since,
          }))
          .sort((a, b) => b.since.localeCompare(a.since));
  const recs: FriendActivityItem[] =
    recommendations?.ready === false
      ? []
      : (recommendations?.items ?? [])
          .filter((r) => r.seenAt === null && r.savedAt === null)
          .map((r) => ({
            kind: "recommendation" as const,
            key: `rec:${r.id}`,
            actionable: false as const,
            from: r.from,
            wine: [r.producer, r.wine, r.year ?? null].filter(Boolean).join(" "),
            since: r.createdAt,
          }))
          .sort((a, b) => b.since.localeCompare(a.since));
  return { items: [...invites, ...recs], requests: invites.length, recommendations: recs.length };
}

/** The name to show for a person: what they call themselves, else their @handle, else null (say "someone"). */
export const personName = (p: PersonCard): string | null =>
  p.displayName?.trim() || (p.handle ? `@${p.handle}` : null);
