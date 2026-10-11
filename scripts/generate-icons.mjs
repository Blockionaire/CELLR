// Renders the app icons from one SVG (so they never drift). Output is committed: `pnpm icons` to regenerate.
// The artwork stays inside the central 80% — the "safe zone" Android's maskable icons may crop to.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/web/public/icons");
fs.mkdirSync(out, { recursive: true });

const SIZE = 1024;
const BOTTLE_H = 740; // 72% of the canvas; corners stay ~376px from centre, inside the 410px maskable safe radius
const scale = BOTTLE_H / 200;
const tx = (SIZE - 60 * scale) / 2;
const ty = (SIZE - BOTTLE_H) / 2;

const body =
  "M26 6H34V40C34 48 48 52 48 68V178Q48 190 36 190H24Q12 190 12 178V68C12 52 26 48 26 40Z";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="#141211"/>
  <g transform="translate(${tx} ${ty}) scale(${scale})">
    <defs><clipPath id="b"><path d="${body}"/></clipPath></defs>
    <path d="${body}" fill="#2a1b1f"/>
    <g clip-path="url(#b)">
      <rect width="60" height="200" fill="#7d2234" opacity="0.9"/>
      <rect x="8" y="104" width="44" height="58" rx="2" fill="#f3eee6" opacity="0.88"/>
      <rect x="15" y="62" width="3" height="118" rx="1.5" fill="#f3eee6" opacity="0.16"/>
    </g>
    <path d="M26 6H34V25H26Z" fill="#b8975f"/>
  </g>
</svg>`;

const render = (size, name) =>
  sharp(Buffer.from(svg))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(out, name));
await Promise.all([
  render(192, "icon-192.png"),
  render(512, "icon-512.png"),
  render(512, "icon-maskable-512.png"),
  render(180, "apple-touch-icon.png"),
  render(32, "icon-32.png"),
]);
fs.writeFileSync(path.join(out, "icon.svg"), svg);
console.log("icons written to", path.relative(process.cwd(), out));
