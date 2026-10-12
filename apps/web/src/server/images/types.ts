import "server-only";
import type { ImageRef, ImageSide } from "@cellr/domain";

export interface ImageRow extends ImageRef {
  side: ImageSide;
  /** Where the full-size photo lives in storage. */
  photoPath: string;
  /** Where the small copy lives; null when only the photo was sent. */
  thumbPath: string | null;
}

export interface NewImage {
  householdId: string;
  side: ImageSide;
  photoPath: string;
  thumbPath: string | null;
  width: number;
  height: number;
  blurColor: string | null;
}

export interface ImageRepository {
  upload(path: string, bytes: Uint8Array): Promise<void>;
  /** Null = no such file (or not yours to read). */
  download(path: string): Promise<Uint8Array | null>;
  remove(paths: string[]): Promise<void>;
  insertImage(row: NewImage): Promise<ImageRow>;
  getImage(id: string): Promise<ImageRow | null>;
}
