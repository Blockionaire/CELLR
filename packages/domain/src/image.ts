import { z } from "zod";

/**
 * Label photos. A photo is untrusted input that ends up in front of other people (and a vision model), so it
 * is cleaned before it is kept: only a well-formed JPEG gets in, and everything that is not picture (the
 * location in the EXIF block, the camera's serial number, thumbnails with a different crop, comments) is
 * removed. This reads the file's structure only; it never decodes the picture, so it is fast and cannot be
 * made to allocate a huge bitmap.
 */

export const IMAGE_SIDES = ["front", "back"] as const;
export type ImageSide = (typeof IMAGE_SIDES)[number];

/**
 * A profile photo as it is kept: the browser makes a square of at most AVATAR_EDGE px (a camera original is never
 * stored), the server refuses anything bigger than this or not a JPEG.
 */
export const AVATAR_LIMITS = {
  bytes: 512 * 1024,
  maxEdge: 1024,
  minEdge: 64,
} as const;
export const AVATAR_EDGE = 512;

export const IMAGE_LIMITS = {
  /** The label photo as it is kept (the browser shrinks phone photos to ~1600 px before sending). */
  photoBytes: 3 * 1024 * 1024,
  /** The small copy for lists and cards. */
  thumbBytes: 300 * 1024,
  /** Longest side accepted, in pixels. */
  maxEdge: 4096,
  /** Most pixels accepted: a bitmap this big is ~64 MB once decoded. */
  maxPixels: 16_000_000,
  /** Longest side of the photo and thumbnail the app itself produces. */
  photoEdge: 1600,
  thumbEdge: 480,
} as const;

export const BlurColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** What a screen needs to show a photo: an id to ask the server for, and a colour to hold the place. */
export interface ImageRef {
  id: string;
  /** The picture's average colour, shown while it loads. */
  blurColor: string | null;
  width: number | null;
  height: number | null;
  /** Whether a straightened picture of just the label exists (what the 3D bottle wears). */
  texture?: boolean;
}

export const AttachPhotoSchema = z.object({
  imageId: z.uuid(),
  side: z.enum(IMAGE_SIDES).default("front"),
  /** Back label only: put it on only when the wine has none yet (atomic on the server); otherwise "exists". */
  onlyIfEmpty: z.boolean().optional(),
});
export type AttachPhoto = z.infer<typeof AttachPhotoSchema>;

export type CleanJpegResult =
  | { ok: true; bytes: Uint8Array; width: number; height: number }
  | { ok: false; reason: "not-jpeg" | "corrupt" | "unsupported" | "too-big" };

const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;

/** Marker segments that are kept: the ones the picture cannot be drawn without. */
const keepsSegment = (marker: number, data: Uint8Array, start: number, end: number): boolean => {
  if (marker === 0xdb || marker === 0xc4 || marker === 0xdd || marker === SOS) return true; // tables, restart interval, scan header
  if (marker >= 0xc0 && marker <= 0xcf) return true; // frame headers (checked separately)
  const head = (text: string) =>
    text.split("").every((c, i) => start + i < end && data[start + i] === c.charCodeAt(0));
  if (marker === 0xe0) return head("JFIF\0"); // the plain JFIF header, not extensions
  if (marker === 0xe2) return head("ICC_PROFILE\0"); // the colour profile, not the multi-picture index
  if (marker === 0xee) return head("Adobe"); // how to read the colours (matters for some files)
  return false; // EXIF, XMP, MPF, comments, anything vendor-specific
};

/**
 * Returns the picture with all metadata removed and its size, or says why it cannot be used. Accepts
 * baseline and progressive JPEG in grey or colour; refuses everything else (HEIC, PNG, CMYK, …) — the
 * browser always sends JPEG.
 */
export function sanitizeJpeg(
  input: Uint8Array,
  maxBytes: number = IMAGE_LIMITS.photoBytes,
): CleanJpegResult {
  if (input.length > maxBytes) return { ok: false, reason: "too-big" };
  if (input.length < 4 || input[0] !== 0xff || input[1] !== SOI || input[2] !== 0xff)
    return { ok: false, reason: "not-jpeg" };

  const out: number[] = [0xff, SOI];
  const push = (from: number, to: number) => {
    for (let i = from; i < to; i++) out.push(input[i]!);
  };
  const n = input.length;
  let i = 2;
  let size: { width: number; height: number } | null = null;
  let scans = 0;

  for (;;) {
    // A marker is 0xFF, any number of 0xFF fill bytes, then its code.
    if (i >= n || input[i] !== 0xff) return { ok: false, reason: "corrupt" };
    const markerStart = i;
    while (i < n && input[i] === 0xff) i++;
    const marker = input[i++];
    if (marker === undefined || marker === 0x00) return { ok: false, reason: "corrupt" };

    if (marker === EOI) break;
    if (marker === SOI) return { ok: false, reason: "corrupt" };
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 0; // standalone markers carry no length
      continue;
    }

    if (i + 2 > n) return { ok: false, reason: "corrupt" };
    const length = (input[i]! << 8) | input[i + 1]!;
    const bodyStart = i + 2;
    const end = i + length;
    if (length < 2 || end > n) return { ok: false, reason: "corrupt" };

    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // Frame header: baseline (C0), extended sequential (C1) and progressive (C2) only.
      if (marker > 0xc2) return { ok: false, reason: "unsupported" };
      if (size) return { ok: false, reason: "corrupt" };
      if (length < 8) return { ok: false, reason: "corrupt" };
      const height = (input[bodyStart + 1]! << 8) | input[bodyStart + 2]!;
      const width = (input[bodyStart + 3]! << 8) | input[bodyStart + 4]!;
      const components = input[bodyStart + 5]!;
      if (width === 0 || height === 0) return { ok: false, reason: "corrupt" };
      if (components !== 1 && components !== 3) return { ok: false, reason: "unsupported" };
      if (
        width > IMAGE_LIMITS.maxEdge ||
        height > IMAGE_LIMITS.maxEdge ||
        width * height > IMAGE_LIMITS.maxPixels
      )
        return { ok: false, reason: "too-big" };
      size = { width, height };
    }

    if (keepsSegment(marker, input, bodyStart, end)) push(markerStart, end);
    i = end;

    if (marker === SOS) {
      if (!size) return { ok: false, reason: "corrupt" };
      // The compressed picture data runs until the next real marker (0xFF00 is an escaped 0xFF, and the
      // restart markers D0–D7 are part of the data).
      const dataStart = i;
      while (i < n) {
        if (input[i] === 0xff) {
          const next = input[i + 1];
          if (next === undefined) return { ok: false, reason: "corrupt" };
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break;
        }
        i++;
      }
      if (i >= n) return { ok: false, reason: "corrupt" };
      push(dataStart, i);
      scans++;
    }
  }

  if (!size || scans === 0) return { ok: false, reason: "corrupt" };
  out.push(0xff, EOI);
  return { ok: true, bytes: Uint8Array.from(out), width: size.width, height: size.height };
}
