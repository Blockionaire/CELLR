import "server-only";
import {
  DEFAULT_SHARING,
  SHARE_ITEMS,
  type FriendEntry,
  type FriendRack,
  type FriendTaste,
  type Recommendation,
  type ShareMode,
  type SharingView,
  type WineType,
} from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { isMissingTable, mapDbError } from "@/server/db/errors";
import type { FriendsRepository } from "./types";

/** The friends step not taken yet: a missing table, function or column. */
const notReady = (error: { code?: string | undefined }) =>
  isMissingTable(error) ||
  error.code === "PGRST202" ||
  error.code === "42703" ||
  error.code === "42883";

const stars = (score: number | null) => (score === null ? null : score / 2);

export function createFriendsRepository(db: Db): FriendsRepository {
  return {
    async me(userId) {
      const { data, error } = await db
        .from("profiles")
        .select("handle, friend_code")
        .eq("id", userId)
        .maybeSingle();
      if (error && notReady(error)) return null;
      if (error) throw mapDbError(error);
      return data ? { handle: data.handle, friendCode: data.friend_code } : null;
    },

    async setHandle(userId, handle) {
      const { error } = await db.from("profiles").update({ handle }).eq("id", userId);
      if (error?.code === "23505") return false;
      if (error) throw mapDbError(error);
      return true;
    },

    async list() {
      const { data, error } = await db.rpc("my_friends");
      if (error && notReady(error)) return null;
      if (error) throw mapDbError(error);
      return data.map((r): FriendEntry => ({
        friendshipId: r.friendship_id,
        userId: r.user_id,
        handle: r.handle,
        displayName: r.display_name,
        friendCode: r.friend_code,
        status: r.status === "accepted" ? "accepted" : "pending",
        direction: r.direction === "incoming" ? "incoming" : "outgoing",
        since: r.since,
      }));
    },

    async find(query) {
      const { data, error } = await db.rpc("find_person", { p_query: query });
      if (error) throw mapDbError(error);
      const r = data[0];
      return r
        ? {
            userId: r.id,
            handle: r.handle,
            displayName: r.display_name,
            friendCode: r.friend_code,
            relation:
              (["requested", "incoming", "friends"] as const).find((x) => x === r.relation) ??
              "none",
          }
        : null;
    },

    async send(userId) {
      const { data, error } = await db.rpc("send_friend_request", { p_user: userId });
      if (error) throw mapDbError(error);
      return data === "accepted" ? "accepted" : data === "already" ? "already" : "sent";
    },

    async respond(friendshipId, accept) {
      const { data, error } = await db.rpc("respond_friend_request", {
        p_id: friendshipId,
        p_accept: accept,
      });
      if (error) throw mapDbError(error);
      return data === true;
    },

    async remove(userId) {
      const { data, error } = await db.rpc("remove_friend", { p_user: userId });
      if (error) throw mapDbError(error);
      return data === true;
    },

    async sharing(userId) {
      const [settings, picks] = await Promise.all([
        db
          .from("sharing_settings")
          .select("ratings, taste, cellar")
          .eq("user_id", userId)
          .maybeSingle(),
        db.from("sharing_picks").select("friend, item").eq("owner", userId),
      ]);
      for (const e of [settings.error, picks.error]) {
        if (e && notReady(e)) return null;
        if (e) throw mapDbError(e);
      }
      const mode = (v: string | undefined, item: (typeof SHARE_ITEMS)[number]): ShareMode =>
        v === "friends" || v === "none" || v === "chosen" ? v : DEFAULT_SHARING[item];
      const view: SharingView = {
        modes: {
          ratings: mode(settings.data?.ratings, "ratings"),
          taste: mode(settings.data?.taste, "taste"),
          cellar: mode(settings.data?.cellar, "cellar"),
        },
        picks: { ratings: [], taste: [], cellar: [] },
      };
      for (const p of picks.data ?? [])
        if ((SHARE_ITEMS as readonly string[]).includes(p.item))
          view.picks[p.item as (typeof SHARE_ITEMS)[number]].push(p.friend);
      return view;
    },

    async saveSharing(userId, { modes, picks }) {
      // The row is always mine: user_id comes from the sign-in (its default), never from the request.
      const saved = await db.from("sharing_settings").upsert(modes, { onConflict: "user_id" });
      if (saved.error) throw mapDbError(saved.error);
      const cleared = await db.from("sharing_picks").delete().eq("owner", userId);
      if (cleared.error) throw mapDbError(cleared.error);
      const rows = SHARE_ITEMS.flatMap((item) =>
        modes[item] === "chosen"
          ? [...new Set(picks[item])].map((friend) => ({ friend, item }))
          : [],
      );
      if (rows.length === 0) return;
      const added = await db.from("sharing_picks").insert(rows);
      if (added.error) throw mapDbError(added.error);
    },

    async access(friendId) {
      const { data, error } = await db.rpc("friend_access", { p_friend: friendId });
      if (error) throw mapDbError(error);
      const r = data[0];
      return { ratings: r?.ratings === true, taste: r?.taste === true, cellar: r?.cellar === true };
    },

    async ratings(friendId) {
      const { data, error } = await db.rpc("friend_ratings", { p_friend: friendId });
      if (error) throw mapDbError(error);
      return data.map((r) => ({
        id: r.tasting_id,
        producer: r.producer,
        wine: r.wine,
        year: r.year,
        type: r.wine_type as WineType,
        region: r.region,
        countryCode: r.country_code,
        stars: stars(r.score),
        words: r.descriptors ?? [],
        note: r.note,
        tastedAt: r.tasted_at,
      }));
    },

    async taste(friendId) {
      const { data, error } = await db.rpc("friend_taste", { p_friend: friendId });
      if (error) throw mapDbError(error);
      const taste = (data as FriendTaste | null) ?? null;
      // No profiles behind the wines they liked: no structure, rather than four empty scales.
      if (taste?.structure && Object.values(taste.structure).every((v) => v === null))
        return { ...taste, structure: null };
      return taste;
    },

    async cellar(friendId) {
      const { data, error } = await db.rpc("friend_cellar", { p_friend: friendId });
      if (error) throw mapDbError(error);
      return data.map((r) => ({
        producer: r.producer,
        wine: r.wine,
        year: r.year,
        type: r.wine_type as WineType,
        region: r.region,
        countryCode: r.country_code,
        bottles: Number(r.bottles),
        places: r.places ?? [],
      }));
    },

    async racks(friendId) {
      const { data, error } = await db.rpc("friend_racks", { p_friend: friendId });
      if (error) throw mapDbError(error);
      return (data as FriendRack[] | null) ?? null;
    },

    async recommend(friendId, vintageId, note) {
      const { data, error } = await db.rpc("recommend_wine", {
        p_friend: friendId,
        p_vintage: vintageId,
        p_note: note,
      });
      if (error) throw mapDbError(error);
      return data;
    },

    async recommendations() {
      const { data, error } = await db.rpc("my_recommendations");
      if (error && notReady(error)) return null;
      if (error) throw mapDbError(error);
      return data.map((r): Recommendation => ({
        id: r.id,
        from: {
          userId: r.sender,
          handle: r.handle,
          displayName: r.display_name,
          friendCode: r.friend_code,
        },
        producer: r.producer,
        wine: r.wine,
        year: r.year,
        type: r.wine_type as WineType,
        region: r.region,
        countryCode: r.country_code,
        note: r.note,
        createdAt: r.created_at,
        seenAt: r.seen_at,
        savedAt: r.saved_at,
      }));
    },

    async markSeen(ids) {
      if (ids.length === 0) return;
      const { error } = await db
        .from("wine_recommendations")
        .update({ seen_at: new Date().toISOString() })
        .in("id", ids)
        .is("seen_at", null);
      if (error) throw mapDbError(error);
    },

    async markSaved(id) {
      const now = new Date().toISOString();
      const { error } = await db
        .from("wine_recommendations")
        .update({ saved_at: now, seen_at: now })
        .eq("id", id);
      if (error) throw mapDbError(error);
    },

    async dismiss(id) {
      const { data, error } = await db
        .from("wine_recommendations")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw mapDbError(error);
      return data.length > 0;
    },
  };
}
