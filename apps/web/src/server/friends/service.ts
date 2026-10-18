import "server-only";
import {
  DomainError,
  type FoundPerson,
  type FriendView,
  type FriendsView,
  type Recommend,
  type RecommendationsView,
  type SaveSharing,
  type WineType,
  type SharingView,
} from "@cellr/domain";
import type { FriendsRepository } from "./types";

const NOT_READY =
  "Friends need one more database step before they work. See docs/SETUP.md, “Updating the database”.";

export type FriendNotice =
  | { kind: "request" | "accepted"; from: string; to: string }
  | { kind: "recommendation"; from: string; to: string; recommendationId: string };

/** What it takes to put a recommended wine on my own wishlist. */
export type SaveToWishlist = (wine: {
  producer: string;
  name: string;
  type: WineType;
  region: string | null;
  countryCode: string | null;
  year: number | null;
  /** Who recommended it, and what they said. */
  recommendedBy: string;
  note: string | null;
}) => Promise<void>;

/**
 * Finding friends by account name or friend code, asking, answering, and what each of you lets the other see.
 * Every read of a friend's wines goes through the database, which checks the friendship and the sharing again.
 */
export function createFriendsService(deps: {
  repo: FriendsRepository;
  userId: string;
  /** Tell the other person on their phone; never fails the request itself. */
  notify: (notice: FriendNotice) => Promise<void>;
  saveToWishlist: SaveToWishlist;
}) {
  const { repo, userId } = deps;
  const tell = (notice: FriendNotice) => deps.notify(notice).catch(() => {});

  return {
    async overview(): Promise<FriendsView> {
      const [me, list] = await Promise.all([repo.me(userId), repo.list()]);
      if (!me || !list)
        return {
          ready: false,
          me: { handle: null, friendCode: null },
          friends: [],
          incoming: [],
          outgoing: [],
        };
      return {
        ready: true,
        me,
        friends: list.filter((f) => f.status === "accepted"),
        incoming: list.filter((f) => f.status === "pending" && f.direction === "incoming"),
        outgoing: list.filter((f) => f.status === "pending" && f.direction === "outgoing"),
      };
    },

    async setHandle(handle: string): Promise<{ handle: string }> {
      if ((await repo.me(userId)) === null) throw new DomainError("INTERNAL", NOT_READY);
      if (!(await repo.setHandle(userId, handle)))
        throw new DomainError("CONFLICT", "That name is taken. Try another one.");
      return { handle };
    },

    async find(query: string): Promise<{ person: FoundPerson | null }> {
      return { person: await repo.find(query) };
    },

    async request(otherId: string): Promise<{ result: "sent" | "accepted" | "already" }> {
      const result = await repo.send(otherId);
      if (result === "sent") await tell({ kind: "request", from: userId, to: otherId });
      if (result === "accepted") await tell({ kind: "accepted", from: userId, to: otherId });
      return { result };
    },

    async respond(friendshipId: string, accept: boolean): Promise<{ ok: true }> {
      const incoming = (await repo.list())?.find(
        (f) =>
          f.friendshipId === friendshipId && f.status === "pending" && f.direction === "incoming",
      );
      if (!incoming || !(await repo.respond(friendshipId, accept)))
        throw new DomainError("NOT_FOUND", "That request is no longer there.");
      if (accept) await tell({ kind: "accepted", from: userId, to: incoming.userId });
      return { ok: true };
    },

    /** Unfriend, withdraw my request, or both: whatever is between us goes. */
    async remove(otherId: string): Promise<{ ok: true }> {
      await repo.remove(otherId);
      return { ok: true };
    },

    async sharing(): Promise<SharingView> {
      const view = await repo.sharing(userId);
      if (!view) throw new DomainError("INTERNAL", NOT_READY);
      return view;
    },

    async saveSharing(input: SaveSharing): Promise<SharingView> {
      // Only people who are my friends now can be picked (the database checks this too).
      const friends = new Set(
        ((await repo.list()) ?? []).filter((f) => f.status === "accepted").map((f) => f.userId),
      );
      const picks = {
        ratings: input.picks.ratings.filter((id) => friends.has(id)),
        taste: input.picks.taste.filter((id) => friends.has(id)),
        cellar: input.picks.cellar.filter((id) => friends.has(id)),
      };
      await repo.saveSharing(userId, { modes: input.modes, picks });
      return this.sharing();
    },

    async friend(otherId: string): Promise<FriendView> {
      const entry = (await repo.list())?.find(
        (f) => f.userId === otherId && f.status === "accepted",
      );
      if (!entry) throw new DomainError("NOT_FOUND", "You are not friends (any more).");
      const access = await repo.access(otherId);
      const [ratings, taste, cellar] = await Promise.all([
        access.ratings ? repo.ratings(otherId) : null,
        access.taste ? repo.taste(otherId) : null,
        access.cellar
          ? Promise.all([repo.cellar(otherId), repo.racks(otherId)]).then(([wines, racks]) => ({
              wines,
              racks: racks ?? [],
            }))
          : null,
      ]);
      return {
        person: {
          userId: entry.userId,
          handle: entry.handle,
          displayName: entry.displayName,
          friendCode: entry.friendCode,
        },
        since: entry.since,
        access,
        ratings,
        taste,
        cellar,
      };
    },

    /** Recommend one of my wines to one or more friends. */
    async recommend({ vintageId, friendIds, note }: Recommend): Promise<{ sent: number }> {
      const friends = new Set(
        ((await repo.list()) ?? []).filter((f) => f.status === "accepted").map((f) => f.userId),
      );
      const to = [...new Set(friendIds)].filter((id) => friends.has(id));
      if (to.length === 0) throw new DomainError("NOT_FOUND", "Choose one of your friends.");
      for (const friendId of to) {
        const recommendationId = await repo.recommend(friendId, vintageId, note);
        await tell({ kind: "recommendation", from: userId, to: friendId, recommendationId });
      }
      return { sent: to.length };
    },

    async recommendations(): Promise<RecommendationsView> {
      const items = await repo.recommendations();
      if (!items) return { ready: false, items: [], unseen: 0 };
      return { ready: true, items, unseen: items.filter((r) => r.seenAt === null).length };
    },

    /** I have looked at them: they stop counting as new. */
    async markSeen(): Promise<{ ok: true }> {
      const items = (await repo.recommendations()) ?? [];
      await repo.markSeen(items.filter((r) => r.seenAt === null).map((r) => r.id));
      return { ok: true };
    },

    /** Put a recommended wine on my wishlist (in my active household), with who recommended it. */
    async saveRecommendation(id: string): Promise<{ ok: true }> {
      const item = (await repo.recommendations())?.find((r) => r.id === id);
      if (!item) throw new DomainError("NOT_FOUND", "That recommendation is no longer there.");
      try {
        await deps.saveToWishlist({
          producer: item.producer,
          name: item.wine,
          type: item.type,
          region: item.region,
          countryCode: item.countryCode,
          year: item.year,
          recommendedBy: personLabel(item.from),
          note: item.note,
        });
      } catch (e) {
        // Already on the wishlist is fine: that is where it was going.
        if (!(e instanceof DomainError && e.code === "CONFLICT")) throw e;
      }
      await repo.markSaved(id);
      return { ok: true };
    },

    async dismissRecommendation(id: string): Promise<{ ok: true }> {
      if (!(await repo.dismiss(id))) throw new DomainError("NOT_FOUND");
      return { ok: true };
    },
  };
}

const personLabel = (p: {
  displayName: string | null;
  handle: string | null;
  friendCode: string;
}) => p.displayName?.trim() || (p.handle ? `@${p.handle}` : p.friendCode);

export type FriendsService = ReturnType<typeof createFriendsService>;
