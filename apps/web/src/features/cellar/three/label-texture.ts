import * as THREE from "three";
import { clampLabelAspect, type WineType } from "@cellr/domain";
import { wrapLines } from "./layout";

/** What is printed on a bottle's front label. */
export interface LabelSpec {
  producer: string;
  name: string;
  /** null = non-vintage */
  year: number | null;
  /** "Bordeaux, France" — may be empty. */
  place: string;
  type: WineType;
  /** A photo of the real label: when there is one, the bottle wears that instead of the drawn label. */
  photoUrl?: string | null | undefined;
  /** The photo is already just the label, straightened: wear all of it, in its own proportions. */
  textured?: boolean | undefined;
  /** A photo of the real back label, when there is one. */
  backPhotoUrl?: string | null | undefined;
}

export const LABEL_W = 640;
export const LABEL_H = 760;
export const LABEL_ASPECT = LABEL_W / LABEL_H;

/** Paper and ink per kind of wine: decorative only, the words on the label carry the meaning. */
const PAPER: Record<WineType, { paper: string; accent: string }> = {
  red: { paper: "#efe6d3", accent: "#7d2234" },
  white: { paper: "#f3eedb", accent: "#7a6a2a" },
  rose: { paper: "#f4e4e1", accent: "#b0556a" },
  sparkling: { paper: "#f1ead2", accent: "#a98838" },
  orange: { paper: "#f1e2cc", accent: "#a8602a" },
  dessert: { paper: "#f2e7c8", accent: "#8a6a1e" },
  fortified: { paper: "#eadcc4", accent: "#6b4326" },
};
const INK = "#2a1e19";
const INK_SOFT = "#6a5a4c";

const SERIF = '"Instrument Serif", ui-serif, Georgia, "Times New Roman", serif';
const SANS = '"Geist Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

/** The app's own fonts, loaded before the label is drawn (a canvas does not wait for them by itself). */
async function fontsReady(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`400 64px ${SERIF}`),
      document.fonts.load(`italic 400 64px ${SERIF}`),
      document.fonts.load(`600 24px ${SANS}`),
    ]);
  } catch {
    // Fall back to the system fonts named in the stacks above.
  }
}

type Ctx = CanvasRenderingContext2D;

function spaced(ctx: Ctx, px: number) {
  if ("letterSpacing" in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** The biggest type (from `start` down to `min`) at which `text` fits in `maxLines` lines. */
function fitName(ctx: Ctx, text: string, maxWidth: number, start: number, min: number) {
  for (let size = start; size >= min; size -= 4) {
    ctx.font = `400 ${size}px ${SERIF}`;
    const lines = wrapLines(text, (s) => ctx.measureText(s).width, maxWidth, 3);
    if (lines) return { size, lines };
  }
  ctx.font = `400 ${min}px ${SERIF}`;
  return { size: min, lines: [text] };
}

/** Draws the front label: producer, name, vintage and place, in the house typography. */
export function drawLabel(ctx: Ctx, spec: LabelSpec): void {
  const { paper, accent } = PAPER[spec.type];
  const W = LABEL_W;
  const H = LABEL_H;
  const cx = W / 2;

  // Paper, a little lighter in the middle, with a fine grain.
  const bg = ctx.createLinearGradient(0, 0, W, 0);
  bg.addColorStop(0, shade(paper, -0.05));
  bg.addColorStop(0.5, shade(paper, 0.03));
  bg.addColorStop(1, shade(paper, -0.05));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 3200; i++) {
    ctx.fillStyle = random() > 0.5 ? "rgba(60,40,20,0.035)" : "rgba(255,255,255,0.05)";
    ctx.fillRect(random() * W, random() * H, 1.6, 1.6);
  }

  // A double rule round the edge.
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 3;
  ctx.strokeRect(26, 26, W - 52, H - 52);
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.strokeRect(38, 38, W - 76, H - 76);
  ctx.globalAlpha = 1;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Producer, small capitals.
  ctx.fillStyle = INK;
  let producerSize = 28;
  let producer = [spec.producer.toUpperCase()];
  for (; producerSize >= 20; producerSize -= 2) {
    ctx.font = `600 ${producerSize}px ${SANS}`;
    spaced(ctx, 5);
    const lines = wrapLines(
      spec.producer.toUpperCase(),
      (s) => ctx.measureText(s).width,
      W - 150,
      2,
    );
    if (lines) {
      producer = lines;
      break;
    }
  }
  ctx.font = `600 ${producerSize}px ${SANS}`;
  spaced(ctx, 5);
  producer.forEach((line, i) => ctx.fillText(line, cx + 2, 100 + i * (producerSize + 10)));
  spaced(ctx, 0);

  // Ornament.
  const orn = producer.length > 1 ? 188 : 170;
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 120, orn);
  ctx.lineTo(cx - 18, orn);
  ctx.moveTo(cx + 18, orn);
  ctx.lineTo(cx + 120, orn);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, orn - 9);
  ctx.lineTo(cx + 9, orn);
  ctx.lineTo(cx, orn + 9);
  ctx.lineTo(cx - 9, orn);
  ctx.closePath();
  ctx.fill();

  // The wine's name: as large as fits, in at most three lines.
  ctx.fillStyle = INK;
  const { size, lines } = fitName(ctx, spec.name, W - 130, 96, 44);
  const lineHeight = size * 1.04;
  const blockTop = 345 - (lines.length * lineHeight) / 2 + lineHeight / 2;
  ctx.font = `400 ${size}px ${SERIF}`;
  lines.forEach((line, i) => ctx.fillText(line, cx, blockTop + i * lineHeight));

  // Vintage.
  ctx.fillStyle = accent;
  ctx.font = `italic 400 128px ${SERIF}`;
  ctx.fillText(spec.year === null ? "NV" : String(spec.year), cx, 565);

  // Place.
  if (spec.place) {
    ctx.fillStyle = INK_SOFT;
    let placeSize = 22;
    ctx.font = `600 ${placeSize}px ${SANS}`;
    spaced(ctx, 4);
    while (placeSize > 15 && ctx.measureText(spec.place.toUpperCase()).width > W - 150) {
      placeSize -= 1;
      ctx.font = `600 ${placeSize}px ${SANS}`;
    }
    ctx.fillText(spec.place.toUpperCase(), cx + 2, 670);
    spaced(ctx, 0);
  }
}

/** A lighter (+) or darker (−) version of a #rrggbb colour. */
function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const part = (shift: number) => {
    const v = (n >> shift) & 255;
    return Math.round(
      Math.min(255, Math.max(0, v + (amount >= 0 ? (255 - v) * amount : v * amount))),
    );
  };
  return `rgb(${part(16)}, ${part(8)}, ${part(0)})`;
}

/** The photo of the real label, or null when it cannot be had (offline, removed): the drawn label stands in. */
async function loadPhoto(url: string): Promise<ImageBitmap | null> {
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    return response.ok ? await createImageBitmap(await response.blob()) : null;
  } catch {
    return null;
  }
}

/** The photo, filling the label's shape (the middle of it when the proportions differ). */
function drawPhoto(ctx: Ctx, photo: ImageBitmap): void {
  const scale = Math.max(LABEL_W / photo.width, LABEL_H / photo.height);
  const w = photo.width * scale;
  const h = photo.height * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(photo, (LABEL_W - w) / 2, (LABEL_H - h) / 2, w, h);
}

/** The label as a texture, ready to wrap round a bottle. The caller owns it and disposes it. */
export async function makeLabelTexture(spec: LabelSpec, maxAnisotropy = 8): Promise<THREE.Texture> {
  const [photo] = await Promise.all([
    spec.photoUrl ? loadPhoto(spec.photoUrl) : null,
    fontsReady(),
  ]);
  // A straightened label keeps its own shape; anything else is the usual drawn or cropped label.
  const flat = spec.textured && photo ? clampLabelAspect(photo.width, photo.height) : null;
  const canvas = document.createElement("canvas");
  canvas.width = flat ? Math.round(LABEL_H * flat) : LABEL_W;
  canvas.height = LABEL_H;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    if (photo && flat) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);
    } else if (photo) drawPhoto(ctx, photo);
    else drawLabel(ctx, spec);
  }
  photo?.close();
  const texture = new THREE.CanvasTexture(canvas);
  texture.userData = { aspect: flat ?? LABEL_ASPECT, photo: photo !== null };
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/** A soft dark pool of light-absorbing shadow under a standing bottle. */
export function makeShadowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(0.55, "rgba(0,0,0,0.22)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The back label: the person's own photo of it, in its own proportions, or else a plainly drawn stand-in (paper,
 * a fine border, the producer's name and a few grey lines for the small print) that no one could take for the real
 * thing. The caller owns the texture.
 */
export async function makeBackLabelTexture(
  spec: LabelSpec,
  maxAnisotropy = 8,
): Promise<THREE.Texture> {
  const [photo] = await Promise.all([
    spec.backPhotoUrl ? loadPhoto(spec.backPhotoUrl) : null,
    fontsReady(),
  ]);
  const aspect = photo ? clampLabelAspect(photo.width, photo.height) : 0.7;
  const canvas = document.createElement("canvas");
  canvas.height = LABEL_H;
  canvas.width = Math.round(LABEL_H * aspect);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    if (photo) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);
    } else drawBackLabel(ctx, spec, canvas.width, canvas.height);
  }
  photo?.close();
  const texture = new THREE.CanvasTexture(canvas);
  texture.userData = { aspect, photo: photo !== null };
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

function drawBackLabel(ctx: Ctx, spec: LabelSpec, W: number, H: number): void {
  const { paper, accent } = PAPER[spec.type];
  ctx.fillStyle = shade(paper, 0.02);
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(24, 24, W - 48, H - 48);
  ctx.globalAlpha = 1;
  ctx.fillStyle = INK_SOFT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 22px ${SANS}`;
  spaced(ctx, 4);
  const lines = wrapLines(
    spec.producer.toUpperCase(),
    (s) => ctx.measureText(s).width,
    W - 110,
    2,
  ) ?? [spec.producer.toUpperCase()];
  lines.forEach((line, i) => ctx.fillText(line, W / 2, 90 + i * 32));
  spaced(ctx, 0);
  // the small print, as grey lines: clearly a drawing, never invented text
  ctx.fillStyle = "rgba(90,74,62,0.22)";
  const left = 64;
  let y = 190;
  for (let i = 0; i < 14; i++) {
    const w = (W - 2 * left) * (i % 5 === 4 ? 0.55 : 0.82 + ((i * 37) % 17) / 100);
    ctx.fillRect(left + (W - 2 * left - w) / 2, y, w, 9);
    y += i % 5 === 4 ? 40 : 24;
  }
  ctx.fillStyle = "rgba(90,74,62,0.35)";
  ctx.fillRect(W / 2 - 60, H - 120, 120, 54);
}
