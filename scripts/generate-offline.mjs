// Generates apps/web/public/offline.html — the page the service worker shows when there is no connection.
// It is fully self-contained on purpose: inline CSS, the two fonts embedded as data URIs, no JavaScript
// and no other requests, so it renders identically with no network and can never fail to hydrate.
// Copy comes from messages/en.json so it cannot drift. Output is committed: `pnpm offline-page` to regenerate.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "apps/web");
const messages = JSON.parse(fs.readFileSync(path.join(web, "messages/en.json"), "utf8")).offline;
const font = (pkg, file) =>
  fs.readFileSync(path.join(web, "node_modules", pkg, "files", file)).toString("base64");
const serif = font("@fontsource/instrument-serif", "instrument-serif-latin-400-normal.woff2");
const sans = font("@fontsource-variable/geist", "geist-latin-wght-normal.woff2");
const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SHAPES = {
  bordeaux: [
    "M26 6H34V40C34 48 48 52 48 68V178Q48 190 36 190H24Q12 190 12 178V68C12 52 26 48 26 40Z",
    "M26 6H34V24H26Z",
  ],
  burgundy: [
    "M26 6H34V46C34 64 50 74 50 98V178Q50 190 38 190H22Q10 190 10 178V98C10 74 26 64 26 46Z",
    "M26 6H34V26H26Z",
  ],
};
const bottle = (shape, tint, i) => {
  const [body, foil] = SHAPES[shape];
  return `<svg viewBox="0 0 60 200" aria-hidden="true"><defs><clipPath id="c${i}"><path d="${body}"/></clipPath></defs><path d="${body}" fill="var(--glass)"/><g clip-path="url(#c${i})"><rect width="60" height="200" fill="${tint}" opacity=".55"/><rect x="8" y="108" width="44" height="52" rx="2" fill="var(--ink)" opacity=".16"/></g><path d="${foil}" fill="#7d2234" opacity=".9"/></svg>`;
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>${esc(messages.title)} · CELLR</title>
<style>
@font-face{font-family:"Instrument Serif";src:url(data:font/woff2;base64,${serif}) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:"Geist Variable";src:url(data:font/woff2;base64,${sans}) format("woff2");font-weight:100 900;font-display:swap}
:root{color-scheme:light dark;--canvas:light-dark(#f6f2ea,#141211);--ink:light-dark(#1e1a17,#f3eee6);--ink-2:light-dark(#5a524a,#b9b1a5);--glass:light-dark(#e6dfd3,#2a2420);--accent:#7d2234;--accent-ink:light-dark(#f6f2ea,#f3eee6)}
*{box-sizing:border-box}
html{background:var(--canvas)}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--canvas);color:var(--ink);font:16px/24px "Geist Variable",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:20rem;text-align:center}
.bottles{display:flex;justify-content:center;align-items:flex-end;gap:12px;margin-bottom:32px}
.bottles svg{width:36px;height:auto;opacity:.9}
h1{margin:0;font:400 28px/34px "Instrument Serif",ui-serif,Georgia,"Times New Roman",serif}
p{margin:8px 0 0;color:var(--ink-2)}
a{display:inline-flex;align-items:center;justify-content:center;height:56px;margin-top:32px;padding:0 24px;border-radius:14px;background:var(--accent);color:var(--accent-ink);font-weight:500;text-decoration:none}
a:active{transform:scale(.98)}
a:focus-visible{outline:2px solid light-dark(#7d2234,#d98a9b);outline-offset:2px}
@media (prefers-reduced-motion:no-preference){main{animation:in .5s cubic-bezier(.2,.8,.2,1) both}@keyframes in{from{opacity:0;transform:translateY(12px)}}}
</style>
</head>
<body>
<main>
<div class="bottles">${bottle("bordeaux", "#7d2234", 0)}${bottle("burgundy", "#c9b87a", 1)}${bottle("bordeaux", "#d98a9b", 2)}</div>
<h1>${esc(messages.title)}</h1>
<p>${esc(messages.body)}</p>
<a href="/">${esc(messages.retry)}</a>
</main>
</body>
</html>
`;
const out = path.join(web, "public/offline.html");
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB)`);
