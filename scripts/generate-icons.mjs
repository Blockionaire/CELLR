// Derives every brand asset from the one source logo (brand/cellr-logo.png), so nothing drifts.
// Output is committed: `pnpm icons` to regenerate.
//   apps/web/public/brand/logo-lockup.png  glass + lettering, burgundy on transparent (used as a CSS mask, so it can take any theme colour)
//   apps/web/public/brand/logo-mark.png    the glass alone
//   apps/web/public/icons/*                home-screen / favicon icons: the glass in burgundy on ivory
// The artwork stays inside the central 80% — the "safe zone" Android's maskable icons may crop to.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "brand/cellr-logo.png");
const brandOut = path.join(root, "apps/web/public/brand");
const iconOut = path.join(root, "apps/web/public/icons");
fs.mkdirSync(brandOut, { recursive: true });
fs.mkdirSync(iconOut, { recursive: true });

const IVORY = { r: 246, g: 242, b: 234 }; // --canvas, light

// ---- 1. Ink coverage: how much of the burgundy is on each pixel (0..1) --------------------------------
const { data, info } = await sharp(source)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;
const px = (x, y, k) => data[(y * W + x) * C + k];
// Paper and ink colours, measured from the file itself (paper = the corner, ink = the solid core of the strokes).
const paper = [0, 1, 2].map((k) => px(4, 4, k));
let inkSum = [0, 0, 0];
let inkN = 0;
for (let i = 0; i < data.length; i += C) {
  if (data[i] < 150) {
    inkSum = inkSum.map((s, k) => s + data[i + k]);
    inkN++;
  }
}
const ink = inkSum.map((s) => Math.round(s / inkN));
const coverage = new Float32Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    // Green carries the most contrast between cream paper and burgundy ink.
    const c = (paper[1] - px(x, y, 1)) / (paper[1] - ink[1]);
    coverage[y * W + x] = Math.min(1, Math.max(0, c));
  }
}

// ---- 2. Crop helpers ---------------------------------------------------------------------------------
function bounds(y0, y1) {
  let minx = W,
    maxx = -1,
    miny = H,
    maxy = -1;
  for (let y = y0; y < y1; y++)
    for (let x = 0; x < W; x++)
      if (coverage[y * W + x] > 0.12) {
        minx = Math.min(minx, x);
        maxx = Math.max(maxx, x);
        miny = Math.min(miny, y);
        maxy = Math.max(maxy, y);
      }
  return { left: minx, top: miny, width: maxx - minx + 1, height: maxy - miny + 1 };
}
// The empty band between the glass and the lettering splits the file in two.
const rowInk = Array.from({ length: H }, (_, y) => {
  let n = 0;
  for (let x = 0; x < W; x++) if (coverage[y * W + x] > 0.12) n++;
  return n;
});
const all = bounds(0, H);
let split = -1;
for (let y = Math.floor(all.top + all.height * 0.6); y < all.top + all.height; y++) {
  if (rowInk[y] === 0) {
    split = y;
    break;
  }
}
if (split < 0) throw new Error("Could not find the gap between the glass and the lettering");
const mark = bounds(0, split);

/** Burgundy RGBA (transparent paper) for a region, as a PNG buffer. */
function ink_png(box) {
  const out = Buffer.alloc(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const o = (y * box.width + x) * 4;
      out[o] = ink[0];
      out[o + 1] = ink[1];
      out[o + 2] = ink[2];
      out[o + 3] = Math.round(coverage[(box.top + y) * W + box.left + x] * 255);
    }
  }
  return sharp(out, { raw: { width: box.width, height: box.height, channels: 4 } }).png({
    compressionLevel: 9,
  });
}

await ink_png(all).toFile(path.join(brandOut, "logo-lockup.png"));
await ink_png(mark).toFile(path.join(brandOut, "logo-mark.png"));
console.log(
  `ink rgb(${ink}) · lockup ${all.width}×${all.height} · mark ${mark.width}×${mark.height}`,
);

// ---- 3. Icons: the glass, burgundy on ivory ------------------------------------------------------------------
const markPng = await ink_png(mark).toBuffer();
async function icon(size, fill, name) {
  const h = Math.round(size * fill);
  const resized = await sharp(markPng).resize({ height: h }).toBuffer();
  const meta = await sharp(resized).metadata();
  return sharp({ create: { width: size, height: size, channels: 3, background: IVORY } })
    .composite([
      {
        input: resized,
        left: Math.round((size - meta.width) / 2),
        top: Math.round((size - h) / 2),
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(iconOut, name));
}
await Promise.all([
  icon(192, 0.66, "icon-192.png"),
  icon(512, 0.66, "icon-512.png"),
  icon(512, 0.62, "icon-maskable-512.png"), // inside the maskable safe zone
  icon(180, 0.66, "apple-touch-icon.png"),
  icon(32, 0.88, "icon-32.png"),
]);
// The SVG favicon wraps the same artwork (browsers that prefer SVG get an identical picture).
const png512 = fs.readFileSync(path.join(iconOut, "icon-512.png")).toString("base64");
fs.writeFileSync(
  path.join(iconOut, "icon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><image width="512" height="512" href="data:image/png;base64,${png512}"/></svg>\n`,
);
console.log("brand assets and icons written");
