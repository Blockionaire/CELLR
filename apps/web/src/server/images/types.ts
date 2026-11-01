import "server-only";
import type { ImageRef, ImageSide } from "@cellr/domain";

export interface ImageRow extends ImageRef {
  side: ImageSide;
  /** Where the full-size photo lives in storage. */
  photoPath: string;
  /** Where the small copy lives; null when only the photo was sent. */
  thumbPath: string | null;
  /** Where the straightened picture of just the label lives; null until one is made. */
  texturePath: string | null;
}

export interface NewImage {
  householdId: string;
  side: ImageSide;
  photoPath: string;
  thumbPath: string | null;
  width: number;
  height: number;
  blurColor: string | null;
  /** SHA-256 (hex) of the stored photo; kept only where the database has the column (see the repository). */
  fingerprint?: string | null;
  cacheResult?: CacheResult | null;
  /** For a scan: what the printed label text did (Sprint S); kept only where the database has the columns. */
  text?: TextMeasure | null;
}

/** For a scan: whether the recognition cache answered (no vision call) or not. */
export type CacheResult = "hit" | "miss";

/**
 * For a scan: whether the label text read on the phone answered it (hit: no vision call), was read but not
 * conclusive (miss), or there was no text (no_text: OCR unavailable, too slow or empty). Never the text itself.
 */
export interface TextMeasure {
  result: "hit" | "miss" | "no_text";
  /** The wine proposed (hit only), and the year read with it. */
  wineId?: string | null;
  year?: number | null;
  /** How long the phone's OCR took, as it reported (bounded), and the server's lookup. */
  ocrMs?: number | null;
  lookupMs?: number | null;
}

export interface ImageRepository {
  upload(path: string, bytes: Uint8Array): Promise<void>;
  /** Null = no such file (or not yours to read). */
  download(path: string): Promise<Uint8Array | null>;
  remove(paths: string[]): Promise<void>;
  insertImage(row: NewImage): Promise<ImageRow>;
  /** Points an image at its straightened label picture (null = none). False when it isn't one of ours. */
  setTexturePath(id: string, path: string | null): Promise<boolean>;
  getImage(id: string): Promise<ImageRow | null>;
  /** Where every file of this household lives in storage (for taking them away with the household). */
  listPaths(householdId: string): Promise<string[]>;
}
