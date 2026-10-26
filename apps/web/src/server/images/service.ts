import "server-only";
import { createHash, randomUUID } from "node:crypto";
import {
  BlurColorSchema,
  DomainError,
  IMAGE_LIMITS,
  sanitizeJpeg,
  type ImageRef,
  type ImageSide,
} from "@cellr/domain";
import type { ActiveHousehold } from "@/server/cellar/types";
import type { CacheResult, ImageRepository } from "./types";

export interface PreparedPhoto {
  side: ImageSide;
  /** The cleaned photo: these exact bytes are stored, read by the model and fingerprinted. */
  photo: Uint8Array;
  width: number;
  height: number;
  thumb: Uint8Array | null;
  blurColor: string | null;
  /** SHA-256 (hex) of `photo`. */
  fingerprint: string;
}

export interface UploadInput {
  side: ImageSide;
  photo: Uint8Array;
  thumb?: Uint8Array | null | undefined;
  blurColor?: string | null | undefined;
}

const refused = (reason: string) =>
  new DomainError(
    "UPLOAD_REJECTED",
    reason === "too-big"
      ? "That photo is too large. Try a smaller one."
      : "We couldn't use that photo. Try another one.",
  );

export function createImageService(
  repo: ImageRepository,
  household: () => Promise<ActiveHousehold>,
) {
  /**
   * Checks and cleans a label photo without keeping it yet: metadata removed, both copies validated. The
   * fingerprint is the SHA-256 of the cleaned photo, so the very same image always gives the same one.
   */
  function prepare(input: UploadInput): PreparedPhoto {
    const photo = sanitizeJpeg(input.photo, IMAGE_LIMITS.photoBytes);
    if (!photo.ok) throw refused(photo.reason);
    const thumb = input.thumb ? sanitizeJpeg(input.thumb, IMAGE_LIMITS.thumbBytes) : null;
    if (thumb && !thumb.ok) throw refused(thumb.reason);
    const blur = BlurColorSchema.safeParse(input.blurColor);
    return {
      side: input.side,
      photo: photo.bytes,
      width: photo.width,
      height: photo.height,
      thumb: thumb?.ok ? thumb.bytes : null,
      blurColor: blur.success ? blur.data.toLowerCase() : null,
      fingerprint: createHash("sha256").update(photo.bytes).digest("hex"),
    };
  }

  /**
   * Keeps a prepared photo for the household: stored under the household's own folder, recorded so bottles can
   * point at it (with its fingerprint, and whether the recognition cache answered for it). If recording fails,
   * the files go again.
   */
  async function save(
    prepared: PreparedPhoto,
    cacheResult: CacheResult | null = null,
  ): Promise<{ image: ImageRef & { side: ImageSide }; photo: Uint8Array }> {
    const { id: householdId } = await household();
    // A fresh folder per photo: nothing is ever overwritten, and no name comes from the client.
    const folder = `${householdId}/${randomUUID()}`;
    const photoPath = `${folder}/photo.jpg`;
    const thumbPath = prepared.thumb ? `${folder}/thumb.jpg` : null;
    const written: string[] = [];
    try {
      await repo.upload(photoPath, prepared.photo);
      written.push(photoPath);
      if (prepared.thumb && thumbPath) {
        await repo.upload(thumbPath, prepared.thumb);
        written.push(thumbPath);
      }
      const row = await repo.insertImage({
        householdId,
        side: prepared.side,
        photoPath,
        thumbPath,
        width: prepared.width,
        height: prepared.height,
        blurColor: prepared.blurColor,
        fingerprint: prepared.fingerprint,
        cacheResult,
      });
      return {
        image: {
          id: row.id,
          side: row.side,
          blurColor: row.blurColor,
          width: row.width,
          height: row.height,
        },
        photo: prepared.photo,
      };
    } catch (error) {
      await repo.remove(written).catch(() => {});
      throw error;
    }
  }

  const store = (input: UploadInput) => save(prepare(input));

  /** The folder a photo's files live in. */
  const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

  return {
    /**
     * Keeps the straightened picture of just the label (made on the phone from the photo's four corners) next to
     * the photo. A new one replaces the old; the 3D bottle wears it.
     */
    async setTexture(imageId: string, bytes: Uint8Array): Promise<ImageRef & { side: ImageSide }> {
      const image = await repo.getImage(imageId);
      if (!image) throw new DomainError("NOT_FOUND");
      const clean = sanitizeJpeg(bytes, IMAGE_LIMITS.photoBytes);
      if (!clean.ok) throw refused(clean.reason);
      const path = `${folderOf(image.photoPath)}/texture-${randomUUID()}.jpg`;
      await repo.upload(path, clean.bytes);
      try {
        if (!(await repo.setTexturePath(imageId, path))) throw new DomainError("NOT_FOUND");
      } catch (error) {
        await repo.remove([path]).catch(() => {});
        throw error;
      }
      if (image.texturePath) await repo.remove([image.texturePath]).catch(() => {});
      return {
        id: image.id,
        side: image.side,
        blurColor: image.blurColor,
        width: image.width,
        height: image.height,
        texture: true,
      };
    },

    /** Goes back to wearing the whole photo. */
    async removeTexture(imageId: string): Promise<void> {
      const image = await repo.getImage(imageId);
      if (!image) throw new DomainError("NOT_FOUND");
      if (!image.texturePath) return;
      await repo.setTexturePath(imageId, null);
      await repo.remove([image.texturePath]).catch(() => {});
    },

    async upload(input: UploadInput): Promise<ImageRef & { side: ImageSide }> {
      return (await store(input)).image;
    },

    /** The two halves of `upload`, for a scan: look the fingerprint up in between. */
    prepare,
    save,

    /**
     * Takes every photo of a household out of storage (before the household itself is deleted). It throws when
     * storage refuses: once the household is gone nothing could find its photos again, so the delete is
     * stopped and can simply be tried again (this is safe to repeat).
     */
    async purge(householdId: string): Promise<void> {
      const paths = await repo.listPaths(householdId);
      for (let i = 0; i < paths.length; i += 100) await repo.remove(paths.slice(i, i + 100));
    },

    /** The bytes of a photo, if it is one of this household's. `thumb` falls back to the photo itself. */
    async file(id: string, variant: "photo" | "thumb" | "texture"): Promise<Uint8Array> {
      const image = await repo.getImage(id);
      if (!image) throw new DomainError("NOT_FOUND");
      const path =
        variant === "texture"
          ? image.texturePath
          : variant === "thumb"
            ? (image.thumbPath ?? image.photoPath)
            : image.photoPath;
      if (!path) throw new DomainError("NOT_FOUND");
      const bytes = await repo.download(path);
      if (!bytes) throw new DomainError("NOT_FOUND");
      return bytes;
    },
  };
}

export type ImageService = ReturnType<typeof createImageService>;
