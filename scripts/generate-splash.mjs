// The iPhone launch images for the home-screen app (apple-touch-startup-image): the same picture as the launch
// screen the page itself draws (apps/web/src/ui/boot-splash.tsx + the .boot-* rules in globals.css), so opening
// the app goes from iOS's image to the page's screen without a jump. Keep the colours, the glow and the logo's
// size and place in step with those. Output is committed: `pnpm splash` to regenerate.
//   apps/web/public/splash/iphone-<w>x<h>@<dpr>.png  one per iPhone screen size, portrait
//   apps/web/src/app/splash-screens.ts               the list, with the media query that picks each one
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logo = path.join(root, "apps/web/public/brand/logo-lockup.png");
const out = path.join(root, "apps/web/public/splash");
const list = path.join(root, "apps/web/src/app/splash-screens.ts");
fs.mkdirSync(out, { recursive: true });

// Portrait screen sizes in CSS points, and their pixel ratio: every iPhone since the SE (1st generation).
const SCREENS = [
  [320, 568, 2],
  [375, 667, 2],
  [375, 812, 3],
  [390, 844, 3],
  [393, 852, 3],
  [402, 874, 3],
  [414, 896, 2],
  [414, 896, 3],
  [428, 926, 3],
  [430, 932, 3],
  [440, 956, 3],
];

const BG = "#0e090b";
const IVORY = { r: 0xf7, g: 0xee, b: 0xdd }; // --hero-ink
const LOGO_PT = 120; // h-[7.5rem]
const LIFT_PT = 16; // the logo sits 1rem above the middle

const logoMeta = await sharp(logo).metadata();
const entries = [];
for (const [w, h, dpr] of SCREENS) {
  const W = w * dpr;
  const H = h * dpr;
  // The two layers of the page's background, in pixels: radial-gradient(70% 45% at 50% 46%, …) and the glow at
  // its resting brightness (opacity 0.5) — radial-gradient(38% 24% at 50% 46%, rgb(122 38 56 / .4), transparent).
  const cx = W / 2;
  const cy = H * 0.46;
  const ellipse = (id, rx, ry, stops) =>
    `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${rx}"
       gradientTransform="translate(${cx} ${cy}) scale(1 ${ry / rx}) translate(${-cx} ${-cy})">${stops}</radialGradient>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      ${ellipse("bg", W * 0.7, H * 0.45, '<stop offset="0" stop-color="#3a0f1a"/><stop offset="0.55" stop-color="#1a0b10"/><stop offset="1" stop-color="#0e090b"/>')}
      ${ellipse("glow", W * 0.38, H * 0.24, '<stop offset="0" stop-color="#7a2638" stop-opacity="0.2"/><stop offset="1" stop-color="#7a2638" stop-opacity="0"/>')}
    </defs>
    <rect width="100%" height="100%" fill="${BG}"/>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <rect width="100%" height="100%" fill="url(#glow)"/>
  </svg>`;

  // The logo in ivory: the artwork's own shape (its alpha) filled with one colour, like the page's CSS mask.
  const lh = Math.round(LOGO_PT * dpr);
  const lw = Math.round((lh * logoMeta.width) / logoMeta.height);
  const alpha = await sharp(logo).resize({ height: lh }).ensureAlpha().extractChannel(3).toBuffer();
  const ivory = await sharp({ create: { width: lw, height: lh, channels: 3, background: IVORY } })
    .joinChannel(alpha)
    .png()
    .toBuffer();

  const name = `iphone-${w}x${h}@${dpr}.png`;
  await sharp(Buffer.from(svg))
    .composite([
      {
        input: ivory,
        left: Math.round(W / 2 - lw / 2),
        top: Math.round(H / 2 - LIFT_PT * dpr - lh / 2),
      },
    ])
    .png({ compressionLevel: 9, palette: true, quality: 100, dither: 1 })
    .toFile(path.join(out, name));
  entries.push({
    url: `/splash/${name}`,
    media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
  });
}

fs.writeFileSync(
  list,
  `// Written by scripts/generate-splash.mjs (\`pnpm splash\`): the iPhone launch images, one per screen size.\n` +
    `export const SPLASH_SCREENS = ${JSON.stringify(entries, null, 2)};\n`,
);
console.log(`${entries.length} launch images in ${path.relative(root, out)}`);
