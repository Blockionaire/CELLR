import "server-only";
import { randomUUID } from "node:crypto";
import {
  BlurColorSchema,
  DomainError,
  IMAGE_LIMITS,
  sanitizeJpeg,
  type ImageRef,
  type ImageSide,
} from "@cellr/domain";
import type { ActiveHousehold } from "@/server/cellar/types";
import type { ImageRepository } from "./types";

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
   * Keeps a label photo for the household: cleaned of metadata, stored under the household's own folder,
   * recorded so bottles can point at it. Both copies are checked; if recording fails, the files go again.
   */
  async function store(
    input: UploadInput,
  ): Promise<{ image: ImageRef & { side: ImageSide }; photo: Uint8Array }> {
    const { id: householdId } = await household();
    const photo = sanitizeJpeg(input.photo, IMAGE_LIMITS.photoBytes);
    if (!photo.ok) throw refused(photo.reason);
    const thumb = input.thumb ? sanitizeJpeg(input.thumb, IMAGE_LIMITS.thumbBytes) : null;
    if (thumb && !thumb.ok) throw refused(thumb.reason);
    const blur = BlurColorSchema.safeParse(input.blurColor);

    // A fresh folder per photo: nothing is ever overwritten, and no name comes from the client.
    const folder = `${householdId}/${randomUUID()}`;
    const photoPath = `${folder}/photo.jpg`;
    const thumbPath = thumb ? `${folder}/thumb.jpg` : null;
    const written: string[] = [];
    try {
      await repo.upload(photoPath, photo.bytes);
      written.push(photoPath);
      if (thumb?.ok && thumbPath) {
        await repo.upload(thumbPath, thumb.bytes);
        written.push(thumbPath);
      }
      const row = await repo.insertImage({
        householdId,
        side: input.side,
        photoPath,
        thumbPath,
        width: photo.width,
        height: photo.height,
        blurColor: blur.success ? blur.data.toLowerCase() : null,
      });
      return {
        image: {
          id: row.id,
          side: row.side,
          blurColor: row.blurColor,
          width: row.width,
          height: row.height,
        },
        photo: photo.bytes,
      };
    } catch (error) {
      await repo.remove(written).catch(() => {});
      throw error;
    }
  }

  return {
    async upload(input: UploadInput): Promise<ImageRef & { side: ImageSide }> {
      return (await store(input)).image;
    },

    /** Like `upload`, and also hands back the cleaned photo (a scan reads it straight away). */
    uploadWithPhoto: store,

    /** Takes every photo of a household out of storage (before the household itself is deleted). Best effort. */
    async purge(householdId: string): Promise<void> {
      const paths = await repo.listPaths(householdId);
      for (let i = 0; i < paths.length; i += 100)
        await repo.remove(paths.slice(i, i + 100)).catch(() => {});
    },

    /** The bytes of a photo, if it is one of this household's. `thumb` falls back to the photo itself. */
    async file(id: string, variant: "photo" | "thumb"): Promise<Uint8Array> {
      const image = await repo.getImage(id);
      if (!image) throw new DomainError("NOT_FOUND");
      const path = variant === "thumb" ? (image.thumbPath ?? image.photoPath) : image.photoPath;
      const bytes = await repo.download(path);
      if (!bytes) throw new DomainError("NOT_FOUND");
      return bytes;
    },
  };
}

export type ImageService = ReturnType<typeof createImageService>;
