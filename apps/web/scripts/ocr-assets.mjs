// Copies the on-device OCR files (tesseract.js worker, its WebAssembly core, the English model) into
// public/ocr/<version>/, so the phone loads them from CELLR itself (no third-party CDN, nothing about the photo
// leaves the phone) and they can be cached for good. Run before `next dev` and `next build`; the folder is not in git.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const tesseract = path.dirname(require.resolve("tesseract.js/package.json"));
const { version } = JSON.parse(fs.readFileSync(path.join(tesseract, "package.json"), "utf8"));
const core = path.dirname(
  createRequire(path.join(tesseract, "package.json")).resolve("tesseract.js-core/package.json"),
);
const eng = path.dirname(require.resolve("@tesseract.js-data/eng/package.json"));

const out = path.join(here, "..", "public", "ocr", version);
const files = [
  [path.join(tesseract, "dist", "worker.min.js"), "worker.min.js"],
  // LSTM-only cores, as JavaScript glue plus a separate binary .wasm (streamed and cached by the browser, smaller
  // than the base64-embedded *.wasm.js builds): with SIMD (Safari 16.4+, recent Chrome/Firefox) and without.
  ...["simd-lstm", "lstm"].flatMap((v) =>
    [`tesseract-core-${v}.js`, `tesseract-core-${v}.wasm`].map((name) => [
      path.join(core, name),
      name,
    ]),
  ),
  // the integer-quantised LSTM model: ~2.9 MB, kept in the phone's IndexedDB after the first use
  [path.join(eng, "4.0.0_best_int", "eng.traineddata.gz"), "eng.traineddata.gz"],
];

// A fresh copy each time the version folder is (re)made: files no longer shipped do not linger.
fs.mkdirSync(out, { recursive: true });
const wanted = new Set(files.map(([, name]) => name));
for (const name of fs.readdirSync(out)) if (!wanted.has(name)) fs.rmSync(path.join(out, name));
let copied = 0;
for (const [from, name] of files) {
  const to = path.join(out, name);
  const stat = fs.statSync(from);
  if (fs.existsSync(to) && fs.statSync(to).size === stat.size) continue;
  fs.copyFileSync(from, to);
  copied += 1;
}
// Older versions' folders are left behind by an upgrade: remove them.
for (const dir of fs.readdirSync(path.dirname(out)))
  if (dir !== version)
    fs.rmSync(path.join(path.dirname(out), dir), { recursive: true, force: true });
console.log(`ocr assets: public/ocr/${version} (${copied} copied)`);
