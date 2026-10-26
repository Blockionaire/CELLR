import "server-only";
import { DomainError, type ImageSide } from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { mapDbError, missingColumn } from "@/server/db/errors";
import { allRows } from "@/server/db/paging";
import type { ImageRepository, ImageRow } from "./types";

export const BUCKET = "bottle-images";
const COLUMNS = "id, side, original_path, web_path, texture_path, width, height, blur_color";

export const toImage = (r: {
  id: string;
  side: string;
  original_path: string;
  web_path: string | null;
  texture_path: string | null;
  width: number | null;
  height: number | null;
  blur_color: string | null;
}): ImageRow => ({
  id: r.id,
  side: r.side as ImageSide,
  photoPath: r.original_path,
  thumbPath: r.web_path,
  texturePath: r.texture_path,
  width: r.width,
  height: r.height,
  blurColor: r.blur_color,
  texture: r.texture_path !== null,
});

/** Storage speaks HTTP statuses, not Postgres codes. */
const storageFailure = (error: {
  message: string;
  status?: number | undefined;
  statusCode?: string | number | undefined;
}) => {
  const status = Number(error.statusCode ?? error.status ?? 0);
  if (status === 403 || status === 401)
    return new DomainError("FORBIDDEN", undefined, { cause: error });
  if (status === 409) return new DomainError("CONFLICT");
  return new DomainError("INTERNAL", undefined, { cause: error, retryable: true });
};

/** Files go through Supabase Storage AS the caller, so its policies (your households' folders only) apply. */
export function createImageRepository(db: Db): ImageRepository {
  const files = db.storage.from(BUCKET);
  return {
    async upload(path, bytes) {
      const { error } = await files.upload(path, bytes, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (error) throw storageFailure(error);
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

    async insertImage(row) {
      const base = {
        household_id: row.householdId,
        side: row.side,
        original_path: row.photoPath,
        web_path: row.thumbPath,
        width: row.width,
        height: row.height,
        blur_color: row.blurColor,
      };
      const insert = (values: typeof base & { fingerprint?: string; cache_result?: string }) =>
        db.from("bottle_images").insert(values).select(COLUMNS).single();
      const remembered = {
        ...(row.fingerprint ? { fingerprint: row.fingerprint } : {}),
        ...(row.cacheResult ? { cache_result: row.cacheResult } : {}),
      };
      let { data, error } = await insert({ ...base, ...remembered });
      // Before the recognition-cache step (20261029000021) the columns do not exist: keep the photo without them.
      if (error && Object.keys(remembered).length > 0 && missingColumn(error))
        ({ data, error } = await insert(base));
      if (error || !data) throw mapDbError(error!);
      return toImage(data);
    },

    async setTexturePath(id, path) {
      const { data, error } = await db
        .from("bottle_images")
        .update({ texture_path: path })
        .eq("id", id)
        .select("id");
      if (error) throw mapDbError(error);
      return (data?.length ?? 0) > 0;
    },

    async listPaths(householdId) {
      const { data, error } = await allRows((from, to) =>
        db
          .from("bottle_images")
          .select("original_path, web_path, texture_path")
          .eq("household_id", householdId)
          .order("id")
          .range(from, to),
      );
      if (error) throw mapDbError(error);
      return data.flatMap((r) =>
        [r.original_path, r.web_path, r.texture_path].filter((p) => p !== null),
      );
    },

    async getImage(id) {
      const { data, error } = await db
        .from("bottle_images")
        .select(COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw mapDbError(error);
      return data ? toImage(data) : null;
    },
  };
}
