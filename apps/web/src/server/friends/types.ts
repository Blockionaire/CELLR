import "server-only";
import type {
  FoundPerson,
  FriendCellarWine,
  FriendEntry,
  FriendRack,
  FriendRating,
  FriendTaste,
  Recommendation,
  SaveSharing,
  ShareItem,
  SharingView,
} from "@cellr/domain";

/** Every read returns null when the database step for friends has not been taken yet. */
export interface FriendsRepository {
  me(userId: string): Promise<{ handle: string | null; friendCode: string } | null>;
  /** false = that name is taken */
  setHandle(userId: string, handle: string): Promise<boolean>;
  list(): Promise<FriendEntry[] | null>;
  find(query: string): Promise<FoundPerson | null>;
  send(userId: string): Promise<"sent" | "accepted" | "already">;
  respond(friendshipId: string, accept: boolean): Promise<boolean>;
  remove(userId: string): Promise<boolean>;
  sharing(userId: string): Promise<SharingView | null>;
  saveSharing(userId: string, sharing: SaveSharing): Promise<void>;
  access(friendId: string): Promise<Record<ShareItem, boolean>>;
  ratings(friendId: string): Promise<FriendRating[]>;
  taste(friendId: string): Promise<FriendTaste | null>;
  cellar(friendId: string): Promise<FriendCellarWine[]>;
  racks(friendId: string): Promise<FriendRack[] | null>;
  /** The new recommendation's id. */
  recommend(friendId: string, vintageId: string, note: string): Promise<string>;
  /** null = the database step for recommendations has not been taken yet. */
  recommendations(): Promise<Recommendation[] | null>;
  markSeen(ids: string[]): Promise<void>;
  markSaved(id: string): Promise<void>;
  /** false = it was not there (or not mine to remove). */
  dismiss(id: string): Promise<boolean>;
}
