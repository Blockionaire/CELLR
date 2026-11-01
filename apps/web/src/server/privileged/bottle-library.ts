import "server-only";
import { randomUUID } from "node:crypto";
import {
  BottlePhotoDetailSchema,
  BottlePhotoListSchema,
  WineVisualRowSchema,
  WineVisualSchema,
  type BottleArtType,
  type BottlePhotoDetail,
  type BottlePhotoList,
  type BottlePhotoStatus,
  type WineVisual,
  type WineVisualFilter,
  type WineVisualRow,
  type WineVisualScope,
} from "@cellr/domain";
import { assertAdmin, type AdminSession } from "@/server/admin/access";
import { logError } from "@/server/log";
import { createServiceClient } from "./client";

/**
 * The bottle library's privileged side. The raw photos people send live in a bucket no signed-in person can touch,
 * so storing, reading and removing them is the service role's job: for the sender (after the server's own checks,
 * always under the sender's own folder) and for the admin (every admin function takes the session only verifyAdmin
 * issues and checks it again). The pictures go to their own private bucket (bottle-art), written only from here; a
 * signed-in person can read one there only while the database says it is the published picture of a wine they can see.
 * "missing" = the database step (20261105000028_bottle_library.sql) is not taken yet; null = no service role.
 */
const PHOTOS = "bottle-submissions";
const ART = "bottle-art";

type Result<T> = Promise<T | "missing" | null>;

const missing = (e: { code?: string }) =>
  e.code === "PGRST202" || e.code === "42883" || e.code === "PGRST205" || e.code === "42P01";

type Rpc = (
  f: string,
  a: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

async function rpc<T>(
  fn: string,
  args: Record<string, unknown>,
  parse: (d: unknown) => T,
): Result<T> {
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await (db.rpc as unknown as Rpc)(fn, args);
  if (error) {
    if (missing(error)) return "missing";
    throw error;
  }
  return parse(data);
}

// ---- For the person sending a photo ----------------------------------------------------------------------------

/** Keeps a checked photo under the sender's own folder; its path, or null when this deployment cannot. */
export async function storeBottlePhoto(userId: string, bytes: Uint8Array): Promise<string | null> {
  const db = createServiceClient();
  if (!db) return null;
  const path = `${userId}/${randomUUID()}.jpg`;
  const { error } = await db.storage
    .from(PHOTOS)
    .upload(path, bytes, { contentType: "image/jpeg", upsert: false });
  if (error) {
    logError("bottle_photo_store_failed", error);
    return null;
  }
  return path;
}

/** Removes photo files (a failed send, or the sender's account going). Only ever paths under that person's folder. */
export async function removeBottlePhotos(userId: string, paths: string[]): Promise<void> {
  const own = paths.filter((p) => p.startsWith(`${userId}/`));
  if (own.length === 0) return;
  const db = createServiceClient();
  if (!db) return;
  const { error } = await db.storage.from(PHOTOS).remove(own);
  if (error) throw new Error(`bottle photo remove failed: ${error.message}`);
}

/** Before an account is deleted: every photo file that person sent (the rows go with the account). */
export async function purgeBottlePhotos(userId: string): Promise<void> {
  const paths = await rpc("bottle_photo_paths_of", { p_user: userId }, (d) =>
    Array.isArray(d) ? d.map(String) : [],
  );
  if (Array.isArray(paths)) await removeBottlePhotos(userId, paths);
}

// ---- For the admin -----------------------------------------------------------------------------------------------

export function readBottlePhotos(
  session: AdminSession,
  status: BottlePhotoStatus | "all",
  limit: number,
  offset: number,
): Result<BottlePhotoList> {
  assertAdmin(session);
  return rpc("admin_bottle_photos", { p_status: status, p_limit: limit, p_offset: offset }, (d) =>
    BottlePhotoListSchema.parse(d),
  );
}

export function readBottlePhoto(
  session: AdminSession,
  id: string,
): Result<BottlePhotoDetail | "none"> {
  assertAdmin(session);
  return rpc("admin_bottle_photo", { p_id: id }, (d) =>
    d === null ? "none" : BottlePhotoDetailSchema.parse(d),
  );
}

export function reviewBottlePhoto(
  session: AdminSession,
  id: string,
  review: { status: BottlePhotoStatus; canonicalWineId: string | null; note: string },
): Result<boolean> {
  assertAdmin(session);
  return rpc(
    "admin_review_bottle_photo",
    {
      p_id: id,
      p_status: review.status,
      p_canonical: review.canonicalWineId,
      p_note: review.note,
      p_actor: session.userId,
    },
    (d) => d === true,
  );
}

/** One photo of a contribution (1 to 3), for the admin's eyes only. */
export async function readBottlePhotoFile(
  session: AdminSession,
  id: string,
  position = 1,
): Promise<Uint8Array | null> {
  assertAdmin(session);
  const path = await rpc("admin_bottle_photo_path", { p_id: id, p_position: position }, (d) =>
    typeof d === "string" ? d : null,
  );
  if (!path || path === "missing") return null;
  const db = createServiceClient();
  if (!db) return null;
  const { data, error } = await db.storage.from(PHOTOS).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export function readWineVisuals(
  session: AdminSession,
  scope: WineVisualScope,
  filter: WineVisualFilter,
  query: string,
  limit = 100,
): Result<WineVisualRow[]> {
  assertAdmin(session);
  return rpc(
    "admin_wine_visuals",
    { p_scope: scope, p_filter: filter, p_query: query, p_limit: limit },
    (d) => WineVisualRowSchema.array().parse(d),
  );
}

export function readWineVisual(session: AdminSession, wineId: string): Result<WineVisual | "none"> {
  assertAdmin(session);
  return rpc("admin_wine_visual", { p_wine: wineId }, (d) =>
    d === null ? "none" : WineVisualSchema.parse(d),
  );
}

/**
 * Stores a checked picture for a wine (a catalogue one or a household's own) as a draft. Its id; "gone" when the wine
 * is not there (the file is removed again); null/"missing" as usual.
 */
export async function addBottleArt(
  session: AdminSession,
  wineId: string,
  picture: { bytes: Uint8Array; type: BottleArtType; width: number; height: number },
  note: string,
): Promise<string | "gone" | "missing" | null> {
  assertAdmin(session);
  const db = createServiceClient();
  if (!db) return null;
  const path = `${wineId}/${randomUUID()}.${picture.type === "image/png" ? "png" : "jpg"}`;
  const { error } = await db.storage
    .from(ART)
    .upload(path, picture.bytes, { contentType: picture.type, upsert: false });
  if (error) throw new Error(`bottle art upload failed: ${error.message}`);
  try {
    const id = await rpc(
      "admin_add_bottle_art",
      {
        p_wine: wineId,
        p_path: path,
        p_type: picture.type,
        p_width: picture.width,
        p_height: picture.height,
        p_note: note,
        p_actor: session.userId,
      },
      (d) => (typeof d === "string" ? d : null),
    );
    if (typeof id === "string" && id !== "missing") return id;
    await db.storage.from(ART).remove([path]);
    return id === "missing" ? "missing" : "gone";
  } catch (e) {
    await db.storage
      .from(ART)
      .remove([path])
      .catch(() => {});
    throw e;
  }
}

/**
 * Publishes a picture as its wine's default. "bad-source" when a ticked photo is not of this wine (nothing changed).
 */
export async function publishBottleArt(
  session: AdminSession,
  artId: string,
  sources: string[],
): Promise<boolean | "bad-source" | "missing" | null> {
  assertAdmin(session);
  try {
    return await rpc(
      "admin_publish_bottle_art",
      { p_art: artId, p_sources: sources, p_actor: session.userId },
      (d) => d === true,
    );
  } catch (e) {
    if ((e as { message?: string }).message === "bad_source") return "bad-source";
    throw e;
  }
}

export function unpublishBottleArt(session: AdminSession, artId: string): Result<boolean> {
  assertAdmin(session);
  return rpc("admin_unpublish_bottle_art", { p_art: artId }, (d) => d === true);
}

/** Removes a picture, then its file (queued by the database, so nothing is left behind if this step fails). */
export async function removeBottleArt(session: AdminSession, artId: string): Result<boolean> {
  assertAdmin(session);
  const path = await rpc("admin_remove_bottle_art", { p_art: artId }, (d) =>
    typeof d === "string" ? d : null,
  );
  if (path === "missing" || path === null) return path === "missing" ? "missing" : false;
  await purgeBottleArtFiles().catch((e) => logError("bottle_art_purge_failed", e));
  return true;
}

/**
 * Deletes the files of pictures that are gone (removed by the admin, or with their wine or household). The database
 * queues each one; a file is unreadable from the moment its picture is gone, this only frees the storage.
 */
export async function purgeBottleArtFiles(): Promise<void> {
  const db = createServiceClient();
  if (!db) return;
  const { data, error } = await db.from("bottle_art_orphans").select("path").limit(200);
  if (error) {
    if (missing(error)) return;
    throw error;
  }
  const paths = (data ?? []).map((r) => r.path);
  if (paths.length === 0) return;
  const removed = await db.storage.from(ART).remove(paths);
  if (removed.error) throw new Error(`bottle art remove failed: ${removed.error.message}`);
  await db.from("bottle_art_orphans").delete().in("path", paths);
}

/** Any picture of a wine (a draft too), for the admin's preview. */
export async function readBottleArtFile(
  session: AdminSession,
  artId: string,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  assertAdmin(session);
  const db = createServiceClient();
  if (!db) return null;
  const { data: row } = await db
    .from("wine_bottle_art")
    .select("path, content_type")
    .eq("id", artId)
    .maybeSingle();
  if (!row) return null;
  const { data, error } = await db.storage.from(ART).download(row.path);
  if (error || !data) return null;
  return { bytes: new Uint8Array(await data.arrayBuffer()), type: row.content_type };
}
