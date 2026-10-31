import "server-only";
import { randomUUID } from "node:crypto";
import { AVATAR_LIMITS, DomainError, sanitizeJpeg } from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { mapDbError } from "@/server/db/errors";

/** The private bucket made for profile photos: `{userId}/…`, written only by that user, read by them and the people
 * they share a household with (storage policies in 20261010000005_storage.sql). */
export const AVATAR_BUCKET = "user-avatars";

export interface AvatarRepository {
  /** The photo's path on someone's profile (RLS: yourself and your household's members; others read as null). */
  getPath(userId: string): Promise<string | null>;
  /** Points my profile at a photo (or none). False when the profile could not be written. */
  setPath(userId: string, path: string | null): Promise<boolean>;
  upload(path: string, bytes: Uint8Array): Promise<void>;
  download(path: string): Promise<Uint8Array | null>;
  remove(paths: string[]): Promise<void>;
}

const refused = (reason: string) =>
  new DomainError(
    "UPLOAD_REJECTED",
    reason === "too-big"
      ? "That photo is too large. Try a smaller one."
      : "We couldn't use that photo. Try another one.",
  );

/**
 * A person's profile photo. The browser makes a small square JPEG (camera originals are never stored); the server
 * checks it is one (and not too big, nor tiny), strips its metadata, keeps it under a fresh name in the person's
 * own folder and points the profile at it. Replacing or removing it deletes the old file. Served only through
 * `/api/v1/avatars/{userId}`, as the viewer, so the storage policies decide who sees it.
 */
export function createAvatarService(repo: AvatarRepository, userId: string) {
  return {
    async set(bytes: Uint8Array): Promise<void> {
      const clean = sanitizeJpeg(bytes, AVATAR_LIMITS.bytes);
      if (!clean.ok) throw refused(clean.reason);
      const edge = Math.max(clean.width, clean.height);
      if (
        edge > AVATAR_LIMITS.maxEdge ||
        Math.min(clean.width, clean.height) < AVATAR_LIMITS.minEdge
      )
        throw refused("size");
      const before = await repo.getPath(userId);
      // A fresh name for every photo: its address changes with it, so no cache ever shows the old one.
      const path = `${userId}/${randomUUID()}.jpg`;
      await repo.upload(path, clean.bytes);
      try {
        if (!(await repo.setPath(userId, path))) throw new DomainError("NOT_FOUND");
      } catch (error) {
        await repo.remove([path]).catch(() => {});
        throw error;
      }
      if (before) await repo.remove([before]).catch(() => {});
    },

    async remove(): Promise<void> {
      const before = await repo.getPath(userId);
      if (!before) return;
      if (!(await repo.setPath(userId, null))) throw new DomainError("NOT_FOUND");
      await repo.remove([before]).catch(() => {});
    },

    /** Someone's photo, if the viewer may see it; anything else is "not found". */
    async file(ofUserId: string): Promise<Uint8Array> {
      const path = await repo.getPath(ofUserId);
      if (!path || !path.startsWith(`${ofUserId}/`)) throw new DomainError("NOT_FOUND");
      const bytes = await repo.download(path);
      if (!bytes) throw new DomainError("NOT_FOUND");
      return bytes;
    },

    /**
     * My photo, when my account is deleted: nothing of mine is left behind in storage (a replaced photo was
     * already removed when it was replaced).
     */
    async purge(): Promise<void> {
      const path = await repo.getPath(userId);
      if (path) await repo.remove([path]);
    },
  };
}

export type AvatarService = ReturnType<typeof createAvatarService>;

/** Profile photos through Supabase as the caller: its row and storage policies apply to every step. */
export function createAvatarRepository(db: Db): AvatarRepository {
  const files = db.storage.from(AVATAR_BUCKET);
  return {
    async getPath(userId) {
      const { data, error } = await db
        .from("profiles")
        .select("avatar_path")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw mapDbError(error);
      return data?.avatar_path ?? null;
    },

    async setPath(userId, path) {
      const { data, error } = await db
        .from("profiles")
        .update({ avatar_path: path })
        .eq("id", userId)
        .select("id")
        .maybeSingle();
      if (error) throw mapDbError(error);
      return data !== null;
    },

    async upload(path, bytes) {
      const { error } = await files.upload(path, bytes, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (error) throw new DomainError("INTERNAL", undefined, { cause: error, retryable: true });
    },

    async download(path) {
      const { data, error } = await files.download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },

    async remove(paths) {
      if (paths.length === 0) return;
      const { error } = await files.remove(paths);
      if (error) throw new Error(`storage remove failed: ${error.message}`);
    },
  };
}
