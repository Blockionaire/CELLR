import "server-only";
import {
  BOTTLE_PHOTO_LIMITS,
  DomainError,
  sanitizeJpeg,
  type BottleArtRef,
  type BottlePhotoResult,
} from "@cellr/domain";
import type { BottleLibraryRepository } from "./repository";

export interface BottleLibraryDeps {
  repo: BottleLibraryRepository;
  /** Keeps a checked photo under the person's own folder in the private bucket; its path, or null. */
  store: (bytes: Uint8Array) => Promise<string | null>;
  /** Removes photo files of this person. */
  remove: (paths: string[]) => Promise<void>;
}

const refused = (reason: string) =>
  new DomainError(
    "UPLOAD_REJECTED",
    reason === "too-big"
      ? "That photo is too large. Try a smaller one."
      : reason === "small"
        ? "That photo is too small to work from. Try a sharper one of the whole bottle."
        : "We couldn't use that photo. Try another one.",
  );

/**
 * A person helping the bottle library with a photo of a whole bottle of a wine they own. Only with their explicit
 * consent, only a clean JPEG (its metadata removed), kept where only the admin can see it. The first photo of a
 * wine earns points; more photos of it are welcome and earn nothing.
 */
export function createBottleLibraryService({ repo, store, remove }: BottleLibraryDeps) {
  return {
    async submit(
      vintageId: string,
      consent: boolean,
      bytes: Uint8Array,
    ): Promise<BottlePhotoResult> {
      if (!consent)
        throw new DomainError("VALIDATION", "Tick the box to let CELLR use your photo.");
      const clean = sanitizeJpeg(bytes, BOTTLE_PHOTO_LIMITS.bytes);
      if (!clean.ok) throw refused(clean.reason);
      if (Math.min(clean.width, clean.height) < BOTTLE_PHOTO_LIMITS.minEdge) throw refused("small");
      const path = await store(clean.bytes);
      if (!path)
        throw new DomainError("INTERNAL", "Sending photos isn't available right now.", {
          retryable: true,
        });
      let sent: { id: string; points: number };
      try {
        sent = await repo.submit({
          vintageId,
          path,
          width: clean.width,
          height: clean.height,
          consent,
        });
      } catch (error) {
        // only a photo that was never recorded is taken away again
        await remove([path]).catch(() => {});
        throw error;
      }
      // The photo is sent and recorded from here on: a total that can't be read just now is simply not shown.
      const total = await repo.points().catch(() => null);
      return { ...sent, total };
    },

    points: () => repo.points(),

    /** Published 2D bottle pictures by wine; a library that cannot be read is simply empty (the app falls back). */
    async art(wineIds: string[]): Promise<Map<string, BottleArtRef>> {
      try {
        return await repo.art(wineIds);
      } catch {
        return new Map();
      }
    },

    async artFile(artId: string) {
      const file = await repo.artFile(artId);
      if (!file) throw new DomainError("NOT_FOUND");
      return file;
    },
  };
}

export type BottleLibraryService = ReturnType<typeof createBottleLibraryService>;
