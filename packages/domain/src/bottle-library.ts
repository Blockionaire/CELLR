import { z } from "zod";
import { IMAGE_LIMITS, sanitizeJpeg } from "./image";
import { WINE_TYPES } from "./cellar";

/**
 * The demand-driven 2D bottle library. People may send a photo of a whole bottle of a wine they own (with consent);
 * the admin turns it into a finished 2D bottle picture and publishes it on the canonical wine, which then shows it
 * by default. The photo people send is raw material and is never shown in the app; only the published picture is.
 */

/** What the first photo of a wine earns a person (once per person and wine; see 20261105000028_bottle_library.sql). */
export const BOTTLE_PHOTO_POINTS = 10;

/** A sent bottle photo as it is kept: the browser shrinks it like a label photo; too small says too little. */
export const BOTTLE_PHOTO_LIMITS = { bytes: IMAGE_LIMITS.photoBytes, minEdge: 400 } as const;

/** A finished 2D bottle picture the admin uploads: PNG (usually with transparency) or JPEG. */
export const BOTTLE_ART_LIMITS = { bytes: 4 * 1024 * 1024, minEdge: 200, maxEdge: 4096 } as const;
export const BOTTLE_ART_TYPES = ["image/png", "image/jpeg"] as const;
export type BottleArtType = (typeof BOTTLE_ART_TYPES)[number];

/** A wine's published 2D bottle picture, as the app shows it. */
export interface BottleArtRef {
  id: string;
  width: number;
  height: number;
}

/** Where the app fetches a published picture (the id is the file's own, so it can be kept for good). */
export const bottleArtUrl = (id: string) => `/api/v1/bottle-art/${id}`;

export const BottlePhotoFieldsSchema = z.object({
  vintageId: z.uuid(),
  // the explicit "yes, CELLR may use this photo" — anything but "true" is no
  consent: z.literal("true", { error: "Tick the box to let CELLR use your photo." }),
});

/** What sending a photo gave back: the points it earned (0 when this wine was already rewarded) and my total. */
export interface BottlePhotoResult {
  id: string;
  points: number;
  total: number;
}

// ---- Checking an uploaded picture -------------------------------------------------------------------------------

export type CleanImageResult =
  | { ok: true; bytes: Uint8Array; width: number; height: number; type: BottleArtType }
  | { ok: false; reason: "not-image" | "corrupt" | "unsupported" | "too-big" };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Chunks that are words about the picture, not the picture: dropped. */
const PNG_DROPPED = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

/**
 * A PNG with its text and EXIF chunks removed, and its size; or why it cannot be used. Reads the file's structure only
 * (never decodes the picture).
 */
export function sanitizePng(input: Uint8Array, maxBytes: number): CleanImageResult {
  if (input.length > maxBytes) return { ok: false, reason: "too-big" };
  if (input.length < 8 || PNG_SIGNATURE.some((b, i) => input[i] !== b))
    return { ok: false, reason: "not-image" };
  const out: number[] = [...PNG_SIGNATURE];
  let i = 8;
  let size: { width: number; height: number } | null = null;
  let data = false;
  for (;;) {
    if (i + 12 > input.length) return { ok: false, reason: "corrupt" };
    const length =
      ((input[i]! << 24) | (input[i + 1]! << 16) | (input[i + 2]! << 8) | input[i + 3]!) >>> 0;
    const type = String.fromCharCode(input[i + 4]!, input[i + 5]!, input[i + 6]!, input[i + 7]!);
    const end = i + 12 + length;
    if (!/^[A-Za-z]{4}$/.test(type) || end > input.length) return { ok: false, reason: "corrupt" };
    if (size === null) {
      if (type !== "IHDR" || length !== 13) return { ok: false, reason: "corrupt" };
      const at = i + 8;
      const width =
        ((input[at]! << 24) | (input[at + 1]! << 16) | (input[at + 2]! << 8) | input[at + 3]!) >>>
        0;
      const height =
        ((input[at + 4]! << 24) |
          (input[at + 5]! << 16) |
          (input[at + 6]! << 8) |
          input[at + 7]!) >>>
        0;
      if (width === 0 || height === 0) return { ok: false, reason: "corrupt" };
      if (
        width > IMAGE_LIMITS.maxEdge ||
        height > IMAGE_LIMITS.maxEdge ||
        width * height > IMAGE_LIMITS.maxPixels
      )
        return { ok: false, reason: "too-big" };
      size = { width, height };
    }
    if (type === "IDAT") data = true;
    if (!PNG_DROPPED.has(type)) for (let k = i; k < end; k++) out.push(input[k]!);
    i = end;
    if (type === "IEND") break;
  }
  if (!size || !data) return { ok: false, reason: "corrupt" };
  return { ok: true, bytes: Uint8Array.from(out), ...size, type: "image/png" };
}

/** An admin's finished picture: a clean PNG or JPEG within the limits, or why not. */
export function cleanBottleArt(input: Uint8Array): CleanImageResult {
  const png = sanitizePng(input, BOTTLE_ART_LIMITS.bytes);
  const clean: CleanImageResult =
    png.ok || png.reason !== "not-image"
      ? png
      : (() => {
          const jpeg = sanitizeJpeg(input, BOTTLE_ART_LIMITS.bytes);
          return jpeg.ok
            ? { ...jpeg, type: "image/jpeg" as const }
            : {
                ok: false as const,
                reason: jpeg.reason === "not-jpeg" ? "not-image" : jpeg.reason,
              };
        })();
  if (!clean.ok) return clean;
  const longest = Math.max(clean.width, clean.height);
  if (longest > BOTTLE_ART_LIMITS.maxEdge) return { ok: false, reason: "too-big" };
  if (Math.min(clean.width, clean.height) < BOTTLE_ART_LIMITS.minEdge)
    return { ok: false, reason: "unsupported" };
  return clean;
}

// ---- The admin's side ---------------------------------------------------------------------------------------------

export const BOTTLE_PHOTO_STATUSES = ["pending", "approved", "rejected", "used"] as const;
export type BottlePhotoStatus = (typeof BOTTLE_PHOTO_STATUSES)[number];
export const parseBottlePhotoFilter = (v: unknown): BottlePhotoStatus | "all" =>
  v === "all" || (BOTTLE_PHOTO_STATUSES as readonly unknown[]).includes(v)
    ? (v as BottlePhotoStatus | "all")
    : "pending";

export const WINE_VISUAL_FILTERS = ["wanted", "published", "all"] as const;
export type WineVisualFilter = (typeof WINE_VISUAL_FILTERS)[number];
export const parseWineVisualFilter = (v: unknown): WineVisualFilter =>
  (WINE_VISUAL_FILTERS as readonly unknown[]).includes(v) ? (v as WineVisualFilter) : "wanted";

const year = z.number().int().nullable();
export const BottlePhotoRowSchema = z.object({
  id: z.uuid(),
  status: z.enum(BOTTLE_PHOTO_STATUSES),
  createdAt: z.string(),
  userId: z.uuid(),
  submitter: z.string().nullable(),
  producer: z.string(),
  wine: z.string(),
  type: z.enum(WINE_TYPES),
  year,
  sourceWineId: z.uuid().nullable(),
  sourceCanonical: z.boolean().nullable(),
  canonicalWineId: z.uuid().nullable(),
  canonicalName: z.string().nullable(),
  consentAt: z.string().nullable(),
  rewardPoints: z.number().int().nullable(),
  rewardAt: z.string().nullable(),
  width: z.number().int(),
  height: z.number().int(),
  artId: z.uuid().nullable(),
  note: z.string().nullable(),
  reviewedAt: z.string().nullable(),
});
export type BottlePhotoRow = z.infer<typeof BottlePhotoRowSchema>;

export const BottlePhotoListSchema = z.object({
  counts: z.record(z.string(), z.number().int()),
  rows: BottlePhotoRowSchema.array(),
});
export type BottlePhotoList = z.infer<typeof BottlePhotoListSchema>;

export const BottlePhotoDetailSchema = BottlePhotoRowSchema.extend({
  photoPath: z.string(),
  suggestedWineId: z.uuid().nullable(),
  related: z
    .object({ id: z.uuid(), status: z.enum(BOTTLE_PHOTO_STATUSES), createdAt: z.string() })
    .array(),
});
export type BottlePhotoDetail = z.infer<typeof BottlePhotoDetailSchema>;

export const WineVisualRowSchema = z.object({
  id: z.uuid(),
  producer: z.string(),
  name: z.string(),
  type: z.enum(WINE_TYPES),
  country: z.string().nullable(),
  published: z.boolean(),
  drafts: z.number().int(),
  pending: z.number().int(),
  photos: z.number().int(),
});
export type WineVisualRow = z.infer<typeof WineVisualRowSchema>;

export const BottleArtAdminSchema = z.object({
  id: z.uuid(),
  width: z.number().int(),
  height: z.number().int(),
  contentType: z.enum(BOTTLE_ART_TYPES),
  note: z.string().nullable(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type BottleArtAdmin = z.infer<typeof BottleArtAdminSchema>;

export const WineVisualSchema = z.object({
  id: z.uuid(),
  producer: z.string(),
  name: z.string(),
  type: z.enum(WINE_TYPES),
  status: z.enum(["canonical", "provisional"]),
  country: z.string().nullable(),
  region: z.string().nullable(),
  appellation: z.string().nullable(),
  art: BottleArtAdminSchema.array(),
  photos: BottlePhotoRowSchema.array(),
  labelPhotos: z.number().int(),
});
export type WineVisual = z.infer<typeof WineVisualSchema>;

export const BottlePhotoReviewSchema = z.object({
  status: z.enum(BOTTLE_PHOTO_STATUSES),
  canonicalWineId: z.union([z.uuid(), z.literal("")]).transform((v) => v || null),
  note: z.string().trim().max(500),
});
