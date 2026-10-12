import { IMAGE_LIMITS } from "@cellr/domain";

/** A label photo made ready to send: a normal-size copy, a small one, and the colour to hold its place. */
export interface PreparedPhoto {
  photo: Blob;
  thumb: Blob;
  blurColor: string;
  width: number;
  height: number;
}

/** The browser could not open the file as a picture (a format it does not know, or not a picture at all). */
export class UnreadablePhotoError extends Error {
  constructor() {
    super("unreadable photo");
    this.name = "UnreadablePhotoError";
  }
}

type Source = { bitmap: CanvasImageSource; width: number; height: number; close: () => void };

/** Opens a file as a picture, turned the way it was held (phones store the turn in the file, not the pixels). */
async function open(file: Blob): Promise<Source> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    // Older browsers: an <img> applies the orientation itself.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return { bitmap: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
    } catch {
      throw new UnreadablePhotoError();
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new UnreadablePhotoError())),
      "image/jpeg",
      quality,
    ),
  );

/** The picture scaled so its longest side is at most `edge` (never enlarged), on white so nothing is see-through. */
function scaled(source: Source, edge: number): HTMLCanvasElement {
  const scale = Math.min(1, edge / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new UnreadablePhotoError();
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source.bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** The average colour of a picture, as #rrggbb: draw it onto one pixel and read that pixel back. */
function averageColor(canvas: HTMLCanvasElement): string {
  const one = document.createElement("canvas");
  one.width = 1;
  one.height = 1;
  const ctx = one.getContext("2d");
  if (!ctx) return "#808080";
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, 1, 1);
  const [r = 128, g = 128, b = 128] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Shrinks a phone photo to what is needed (a 12-megapixel photo is 5 MB; this is a few hundred KB), straightens
 * it, and re-encodes it. Re-encoding drops the location and camera details the file carried: the picture is
 * all that leaves the phone.
 */
export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  const source = await open(file);
  try {
    if (source.width < 1 || source.height < 1) throw new UnreadablePhotoError();
    const big = scaled(source, IMAGE_LIMITS.photoEdge);
    const small = scaled(source, IMAGE_LIMITS.thumbEdge);
    return {
      photo: await toBlob(big, 0.85),
      thumb: await toBlob(small, 0.8),
      blurColor: averageColor(small),
      width: big.width,
      height: big.height,
    };
  } finally {
    source.close();
  }
}

/** The form the server expects for `POST /api/v1/images`. */
export function photoForm(prepared: PreparedPhoto, side: "front" | "back" = "front"): FormData {
  const form = new FormData();
  form.set("photo", prepared.photo, "photo.jpg");
  form.set("thumb", prepared.thumb, "thumb.jpg");
  form.set("side", side);
  form.set("blurColor", prepared.blurColor);
  return form;
}
