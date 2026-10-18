import { z } from "zod";
import type { WineType } from "./cellar";

// ---- Account name -----------------------------------------------------------------------------------------

/** "@joost": 3–20 lowercase letters, digits, dots and underscores, starting with a letter or digit. */
export const HandleSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@/, "").toLowerCase())
  .pipe(
    z
      .string()
      .regex(/^[a-z0-9][a-z0-9_.]{2,19}$/, "3–20 letters, digits, dots or underscores.")
      .refine((v) => !v.includes(".."), "No two dots in a row."),
  );

export const SetHandleSchema = z.object({ handle: HandleSchema });

/** What someone types to find a friend: an account name or a friend code. */
export const FindPersonSchema = z.object({ q: z.string().trim().min(3).max(40) });

// ---- People and requests ----------------------------------------------------------------------------------

export type Relation = "none" | "requested" | "incoming" | "friends";

export interface PersonCard {
  userId: string;
  handle: string | null;
  displayName: string | null;
  friendCode: string;
}

export interface FoundPerson extends PersonCard {
  relation: Relation;
}

export interface FriendEntry extends PersonCard {
  friendshipId: string;
  status: "pending" | "accepted";
  /** For a request: who asked. */
  direction: "incoming" | "outgoing";
  since: string;
}

export interface FriendsView {
  /** False until the database step for friends has been taken. */
  ready: boolean;
  me: { handle: string | null; friendCode: string | null };
  friends: FriendEntry[];
  incoming: FriendEntry[];
  outgoing: FriendEntry[];
}

export const SendRequestSchema = z.object({ userId: z.uuid() });
export const RespondSchema = z.object({ accept: z.boolean() });

// ---- Sharing ----------------------------------------------------------------------------------------------

export const SHARE_ITEMS = ["ratings", "taste", "cellar"] as const;
export type ShareItem = (typeof SHARE_ITEMS)[number];
export const SHARE_MODES = ["friends", "none", "chosen"] as const;
export type ShareMode = (typeof SHARE_MODES)[number];

/** Ratings and taste are for friends unless you say otherwise; the cellar only when you choose to. */
export const DEFAULT_SHARING: Record<ShareItem, ShareMode> = {
  ratings: "friends",
  taste: "friends",
  cellar: "none",
};

export interface SharingView {
  modes: Record<ShareItem, ShareMode>;
  /** With "chosen": which friends, per item. */
  picks: Record<ShareItem, string[]>;
}

export const SaveSharingSchema = z.object({
  modes: z.object({
    ratings: z.enum(SHARE_MODES),
    taste: z.enum(SHARE_MODES),
    cellar: z.enum(SHARE_MODES),
  }),
  picks: z.object({
    ratings: z.array(z.uuid()).max(500),
    taste: z.array(z.uuid()).max(500),
    cellar: z.array(z.uuid()).max(500),
  }),
});
export type SaveSharing = z.infer<typeof SaveSharingSchema>;

// ---- What a friend shares -----------------------------------------------------------------------------

export interface FriendRating {
  id: string;
  producer: string;
  wine: string;
  year: number | null;
  type: WineType;
  region: string | null;
  countryCode: string | null;
  /** 0.5–5 */
  stars: number | null;
  words: string[];
  note: string | null;
  tastedAt: string;
}

export interface FriendTaste {
  tastings: number;
  /** Average stars, 0.5–5. */
  average: number | null;
  byType: Array<{ type: WineType; count: number; average: number | null }>;
  regions: Array<{ region: string; count: number; average: number | null }>;
  words: Array<{ word: string; count: number }>;
  /** How the wines they rated 4 stars or more tend to feel, 1–5 each. */
  structure: {
    body: number | null;
    tannin: number | null;
    sweetness: number | null;
    acidity: number | null;
  } | null;
  favourites: Array<{
    producer: string;
    wine: string;
    year: number | null;
    type: WineType;
    stars: number;
  }>;
}

export interface FriendCellarWine {
  producer: string;
  wine: string;
  year: number | null;
  type: WineType;
  region: string | null;
  countryCode: string | null;
  bottles: number;
  places: string[];
}

export interface FriendRack {
  label: string;
  kind: string;
  rows: number;
  cols: number;
  bottles: Array<{
    row: number;
    col: number;
    type: WineType;
    producer: string;
    wine: string;
    year: number | null;
  }>;
}

export interface FriendView {
  person: PersonCard;
  since: string;
  access: Record<ShareItem, boolean>;
  ratings: FriendRating[] | null;
  taste: FriendTaste | null;
  cellar: { wines: FriendCellarWine[]; racks: FriendRack[] } | null;
}

/** A taste profile in a sentence's worth of parts: what they drink most, and how they like it to feel. */
export function tasteHeadline(taste: FriendTaste): {
  favouriteType: WineType | null;
  leanings: Array<"full" | "light" | "firm" | "soft" | "dry" | "sweet" | "fresh">;
} {
  const favouriteType = taste.byType[0]?.type ?? null;
  const s = taste.structure;
  const leanings: Array<"full" | "light" | "firm" | "soft" | "dry" | "sweet" | "fresh"> = [];
  if (s) {
    if (s.body !== null && (s.body >= 3.5 || s.body <= 2.5))
      leanings.push(s.body >= 3.5 ? "full" : "light");
    if (s.tannin !== null && (s.tannin >= 3.5 || s.tannin <= 2.5))
      leanings.push(s.tannin >= 3.5 ? "firm" : "soft");
    if (s.sweetness !== null) leanings.push(s.sweetness >= 3 ? "sweet" : "dry");
    if (s.acidity !== null && s.acidity >= 3.5) leanings.push("fresh");
  }
  return { favouriteType, leanings: [...new Set(leanings)] };
}
