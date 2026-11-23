// Label OCR evaluation: renders photographed labels in Chromium, runs the app's photo path and tesseract.js with
// several page-segmentation strategies, and scores identity + vintage with the domain's own decision code.
// On-device label OCR, a year printed alone on its line: renders photographed labels in Chromium, runs the app's own
// photo path (preparePhoto, then the reader's 1280 px copy) and tesseract.js with several page-segmentation
// strategies, and scores identity and vintage with the domain's own decision code (recognizeLabelText,
// vintageFromLabel). Variant "app" is apps/web/src/features/scan/ocr.ts itself, bundled for the page.
// Results: README.md next to this file. Usage (from the repository root, after `pnpm install` and
// `node apps/web/scripts/ocr-assets.mjs`):
//   scripts/scan-eval/node_modules/.bin/tsx docs/spikes/ocr-lone-year/run.mts [count] [variants] [--keep]
// Environment: FAMILY=render|e2e, OFFSET, LAYOUTS, ORNAMENT, E2E_FONT, E2E_YEAR, E2E_WORD, E2E_EXACT, E2E_FIXED,
// E2E_SIZE=WxH, PLAYWRIGHT_CHROMIUM_PATH.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { labelLines, recognizeLabelText, vintageFromLabel } from "../../../packages/domain/src/label-text.ts";
import type { WineSummary } from "../../../packages/domain/src/cellar.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const web = createRequire(path.join(root, "apps/web/package.json"));
const { chromium } = web("@playwright/test");
const sharp = web("sharp");
const tesseract = path.dirname(web.resolve("tesseract.js/package.json"));
const tessDist = path.join(tesseract, "dist");
const ocrDir = path.join(root, "apps/web/public/ocr", web("tesseract.js/package.json").version);
const outDir = path.join(root, "test-results/ocr-lone-year");
fs.mkdirSync(outDir, { recursive: true });
// the production reader, bundled for the page (esbuild comes with tsx)
const esbuild = createRequire(createRequire(path.join(root, "scripts/scan-eval/package.json")).resolve("tsx/package.json"))("esbuild");
const entry = path.join(outDir, "entry.ts");
fs.writeFileSync(
  entry,
  `import { readLabelText, warmOcr, ocrStatus } from ${JSON.stringify(path.join(root, "apps/web/src/features/scan/ocr.ts"))};\n` +
    "(window as any).app = { readLabelText, warmOcr, ocrStatus };\n",
);
await esbuild.build({ entryPoints: [entry], bundle: true, format: "esm", platform: "browser", outfile: path.join(outDir, "app-ocr.js"), logLevel: "warning" });
const NOW = new Date("2026-11-23T12:00:00Z");

const count = Number(process.argv[2] ?? 40);
const variants = (process.argv[3] ?? "sparse,auto,sparse+line,sparse+digits").split(",");
const keep = process.argv.includes("--keep");
const offset = Number(process.env.OFFSET ?? 0);

const server = http.createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0]!;
  let file: string;
  if (url === "/" || url === "/page.html") file = path.join(here, "page.html");
  else if (url === "/app-ocr.js") file = path.join(outDir, "app-ocr.js");
  else if (url === "/tesseract.min.js") file = path.join(tessDist, "tesseract.min.js");
  else if (url.startsWith("/ocr/")) file = path.join(ocrDir, path.basename(url));
  else return res.writeHead(404).end();
  const type = file.endsWith(".wasm")
    ? "application/wasm"
    : file.endsWith(".js")
      ? "text/javascript"
      : file.endsWith(".html")
        ? "text/html"
        : "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  fs.createReadStream(file).pipe(res);
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;

// ---------- the evaluation set ----------
type Wine = WineSummary & { app: string; fine: string };
const wine = (
  i: number,
  producer: string,
  name: string,
  type: WineSummary["type"],
  countryCode: string,
  app: string,
  fine: string,
): Wine => ({ id: `w${i}`, producer, name, type, countryCode, region: null, catalog: true, aliases: [], app, fine });
const WINES: Wine[] = [
  wine(1, "Domaine des Trois Chênes", "Cuvée Silex", "white", "FR", "Pouilly-Fumé", "Produit de France"),
  wine(2, "Château Belle-Rive", "Les Terrasses", "red", "FR", "Saint-Émilion", "Mis en bouteille au château"),
  wine(3, "Weingut Hofmann", "Schieferterrassen", "white", "DE", "Mosel", "Produce of Germany"),
  wine(4, "Bodega Las Piedras", "Viña Alta", "red", "ES", "Rioja", "Producto de España"),
  wine(5, "Tenuta San Lorenzo", "Poggio Alto", "red", "IT", "Toscana", "Prodotto in Italia"),
  wine(6, "Quinta do Vale Fundo", "Encostas", "red", "PT", "Douro", "Produto de Portugal"),
  wine(7, "Domaine Martin Frères", "Clos des Murgers", "red", "FR", "Bourgogne", "Produit de France"),
  wine(8, "Cave de Chavignol", "Le Grand Caillou", "white", "FR", "Sancerre", "Produit de France"),
  wine(9, "Ridgeback Cellars", "Old Vine Zinfandel", "red", "US", "Sonoma County", "Product of USA"),
  wine(10, "Kloof Estate", "Steen op Hout", "white", "ZA", "Stellenbosch", "Wine of South Africa"),
  wine(11, "Maison Lenoir", "Les Grès", "red", "FR", "Côtes du Rhône", "Produit de France"),
  wine(12, "Schloss Albrechtsberg", "Vom Löss", "white", "AT", "Kamptal", "Österreichischer Qualitätswein"),
];
const FONTS = [
  "DejaVu Sans",
  "DejaVu Serif",
  "Liberation Serif",
  "Liberation Sans",
  "FreeSerif",
  "FreeSans",
  "Caladea",
  "Bitstream Charter",
  "Inter",
  "Carlito",
];
type Layout = "alone" | "alone-top" | "alone-small" | "alone-big" | "with-word" | "none" | "corner" | "columns";
const LAYOUTS: [Layout, number][] = process.env.LAYOUTS ? process.env.LAYOUTS.split(",").map((l) => [l as Layout, 1]) : [
  ["alone", 40],
  ["alone-top", 10],
  ["alone-small", 15],
  ["alone-big", 10],
  ["with-word", 15],
  ["none", 10],
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
const weighted = <T,>(r: () => number, xs: readonly [T, number][]) => {
  let x = r() * xs.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of xs) if ((x -= w) < 0) return v;
  return xs[0]![0];
};

function makeSpec(seed: number) {
  const r = rng(seed);
  const w = WINES[seed % WINES.length]!;
  const layout = weighted(r, LAYOUTS);
  const year = 1995 + Math.floor(r() * 30);
  const font = pick(r, FONTS);
  const serifNames = r() < 0.5;
  const yearFont = r() < 0.7 ? font : pick(r, FONTS);
  const L = (text: string, size: number, o: Record<string, unknown> = {}) => ({ text, font, size, ...o });
  const producer = L(w.producer.toUpperCase(), 0.055, { weight: r() < 0.5 ? 700 : 400, spacing: r() * 0.12 });
  const name = L(w.name, 0.08, { style: serifNames && r() < 0.5 ? "italic" : "normal", weight: r() < 0.3 ? 700 : 400 });
  const yearSize = layout === "alone-small" ? 0.045 : layout === "alone-big" ? 0.13 : 0.07;
  const yearLine = { text: String(year), font: yearFont, size: yearSize, weight: r() < 0.4 ? 700 : 400, spacing: r() * 0.1 };
  const app = L(w.app, 0.05);
  const fine = L(`${w.fine} · 750 ml · ${12 + Math.floor(r() * 3)},5 % vol`, 0.03);
  let lines;
  let expectedYear: number | null = year;
  switch (layout) {
    case "alone":
      lines = [producer, name, yearLine, app, fine];
      break;
    case "alone-top":
      lines = [yearLine, producer, name, app, fine];
      break;
    case "alone-small":
      lines = [producer, name, app, yearLine, fine];
      break;
    case "alone-big":
      lines = [producer, yearLine, name, app, fine];
      break;
    case "with-word":
      lines = [producer, name, { ...yearLine, text: `${pick(r, ["Millésime", "Vintage", w.app])} ${year}`, size: 0.055 }, fine];
      break;
    case "corner":
      // the year alone in a top corner, the name big in the middle, fine print split over the bottom corners
      lines = [
        { ...producer, at: [0.5, 0.33] },
        { ...name, size: 0.1, at: [0.5, 0.45] },
        { ...yearLine, align: r() < 0.5 ? "right" : "left", at: [0, 0.1] },
        { ...app, at: [0.5, 0.82] },
        { ...fine, text: w.fine, align: "left", at: [0.08, 0.93] },
        { ...fine, text: "750 ml", align: "right", at: [0.92, 0.93] },
      ];
      lines[2]!.at = [lines[2]!.align === "right" ? 0.9 : 0.1, 0.1];
      break;
    case "columns":
      // producer and name left, year and appellation right, as on many back-and-front hybrids
      lines = [
        { ...producer, size: 0.045, align: "left", at: [0.08, 0.3] },
        { ...name, size: 0.065, align: "left", at: [0.08, 0.4] },
        { ...yearLine, size: 0.06, align: "right", at: [0.92, 0.3] },
        { ...app, align: "right", at: [0.92, 0.4] },
        { ...fine, align: "center", at: [0.5, 0.9] },
      ];
      break;
    case "none":
      lines = [producer, name, app, fine];
      expectedYear = null;
      break;
  }
  const long = Math.round(1000 + r() * 3032);
  const portrait = r() < 0.8;
  const short = Math.round(long * 0.75);
  const W = portrait ? short : long;
  const H = portrait ? long : short;
  return {
    meta: { seed, wine: w.id, layout, font, yearFont, year: expectedYear },
    spec: {
      seed,
      W,
      H,
      lines,
      paper: pick(r, ["#f4ecd8", "#efe6cf", "#f8f5ee", "#e9dfc4", "#f1efe8"]),
      ink: pick(r, ["#2a1d14", "#1a1a1a", "#3b2a1a", "#222244", "#4a1010"]),
      frac: (portrait ? 0.55 : 0.4) + r() * 0.3,
      rotate: (r() - 0.5) * 8,
      curve: r() < 0.5 ? 0.3 + r() * 0.6 : 0,
      blur: r() < 0.5 ? r() * 1.2 * (long / 2000) : 0,
      noise: r() < 0.6 ? r() * 14 : 0,
      quality: 0.8 + r() * 0.12,
      ornament: process.env.ORNAMENT ?? pick(r, [null, null, "crest", "hills", "both"]),
      bg: pick(r, [["#1b1b1b", "#3a2f25"], ["#20140c", "#4a3626"], ["#0e1a12", "#26382c"], ["#2b2b2e", "#101012"]]),
      keep,
    },
  };
}

// ---------- scoring ----------
type Year = "correct" | "wrong" | "none";
function score(text: string, w: Wine, expected: number | null) {
  const lines = labelLines(text);
  const got = vintageFromLabel(lines, w, NOW);
  const year: Year = got === expected ? "correct" : got === null ? "none" : "wrong";
  const rec = recognizeLabelText(text, [{ wine: w, linkedTo: null }], NOW);
  const match = rec.kind === "match" && rec.catalogWineId === w.id;
  return { got, year, match, reason: rec.kind === "none" ? rec.reason : null };
}

// sanity: a perfect transcript is a match with the right year
for (let s = 0; s < 30; s++) {
  const { meta, spec } = makeSpec(s);
  const w = WINES.find((x) => x.id === meta.wine)!;
  const perfect = spec.lines.map((l) => l.text).join("\n");
  const sc = score(perfect, w, meta.year);
  if (!sc.match || sc.year !== "correct") throw new Error(`perfect transcript fails: ${perfect} ${JSON.stringify(sc)}`);
}

const FAMILY = process.env.FAMILY ?? "render";
// The e2e test's own label (apps/web/e2e/sprint-s.spec.ts labelPhoto), with the font, year and size varied.
function e2eSpec(seed: number) {
  const r = rng(seed * 31 + 7);
  const w = { ...WINES[seed % WINES.length]! };
  const font = process.env.E2E_FONT ?? "DejaVu Sans";
  const year = process.env.E2E_YEAR ? Number(process.env.E2E_YEAR) : 1995 + Math.floor(r() * 30);
  const size = { width: 1100 + Math.floor(r() * 300), height: 1500 + Math.floor(r() * 60) };
  const yearText = process.env.E2E_WORD ? `${process.env.E2E_WORD} ${year}` : String(year);
  let lines = [w.producer.toUpperCase(), w.name, yearText, w.app, w.fine];
  if (process.env.E2E_EXACT) {
    // sprint-s.spec.ts exactly: random syllable names, its five lines, every size uniqueSize() can give
    const word = () => {
      const c = "BDKLMNRTV", v = "AEIOU";
      let s = "";
      for (let i = 0; i < 3; i++) s += c[Math.floor(r() * c.length)]! + v[Math.floor(r() * v.length)]!;
      return s[0] + s.slice(1).toLowerCase();
    };
    const producer = `Domaine ${word()}`;
    const name = `Cuvée ${word()}`;
    w.producer = producer; w.name = name; w.countryCode = "FR"; w.type = "white";
    lines = [producer.toUpperCase(), name, yearText, "Pouilly-Fumé", "Produit de France"];
    size.width = 1100 + (seed % 70);
    size.height = 1500 + 3 * (Math.floor(seed / 70) % 4);
  }
  if (process.env.E2E_FIXED) {
    // no resampling anywhere (long edge <= 1280) and the label at a fixed place: the same pixels whatever the size
    size.width = 900 + (seed % 70);
    size.height = 1200 + 3 * (Math.floor(seed / 70) % 4);
  }
  if (process.env.E2E_SIZE) [size.width, size.height] = process.env.E2E_SIZE.split("x").map(Number) as [number, number];
  const x = process.env.E2E_FIXED ? 450 : size.width / 2;
  const text = lines
    .map((t, i) => `<text x="${x}" y="${560 + i * 110}" font-family="${font}, sans-serif" font-size="${i < 2 ? 70 : 56}" text-anchor="middle" fill="#2a1d14">${t}</text>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}">
    <rect width="100%" height="100%" fill="#2e2620"/>
    <rect x="${x - 380}" y="420" width="760" height="${110 * lines.length + 160}" rx="12" fill="#f3ead8"/>
    ${text}</svg>`;
  return { meta: { seed, wine: w.id, layout: "alone", font, yearFont: font, year }, svg, size, w };
}
async function specFor(i: number): Promise<{ meta: any; spec: any; w?: Wine }> {
  if (FAMILY === "render") return makeSpec(i);
  const e = e2eSpec(i);
  const jpeg: Buffer = await sharp(Buffer.from(e.svg)).jpeg({ quality: 88 }).toBuffer();
  return { meta: e.meta, w: e.w, spec: { jpeg: jpeg.toString("base64"), W: e.size.width, H: e.size.height, lines: [], keep } };
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const page = await browser.newPage();
page.on("console", (m) => m.type() === "error" && console.error("page:", m.text()));
await page.goto(`http://127.0.0.1:${port}/page.html`);
await page.evaluate(() => (window as any).init());

const rows: any[] = [];
for (let i = offset; i < offset + count; i++) {
  const { meta, spec, w: own } = await specFor(i);
  const w = own ?? WINES.find((x) => x.id === meta.wine)!;
  const res = await page.evaluate(([s, v]) => (window as any).evalSample(s, v), [spec, variants] as const);
  const row: any = { ...meta, size: res.size, photo: [spec.W, spec.H] };
  for (const v of variants) {
    if (!res[v]) continue;
    row[v] = { ...score(res[v].text, w, meta.year), ms: Math.round(res[v].ms), text: res[v].text, rereads: res[v].rereads };
  }
  if (res.sparse) row.sparseLines = res.sparse.lines;
  if (keep && res.image) fs.writeFileSync(path.join(outDir, `s${i}.jpg`), Buffer.from(res.image.split(",")[1], "base64"));
  rows.push(row);
  process.stdout.write(
    `${i} ${meta.layout.padEnd(11)} ${meta.font.padEnd(17)} ${String(meta.year).padEnd(4)} ` +
      variants.map((v) => `${v}:${row[v]?.year[0]}${row[v]?.match ? "M" : "-"}${row[v]?.got ?? ""}`).join(" ") +
      "\n",
  );
}
await browser.close();
server.close();
const file = path.join(outDir, `rows-${offset}-${count}-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify(rows, null, 1));

// ---------- summary ----------
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-");
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
};
console.log(`\n${rows.length} samples -> ${file}`);
for (const v of variants) {
  const rs = rows.filter((r) => r[v]);
  const withYear = rs.filter((r) => r.year !== null);
  const alone = rs.filter((r) => r.layout.startsWith("alone"));
  const ms = rs.map((r) => r[v].ms);
  console.log(
    `${v.padEnd(14)} identity ${pct(rs.filter((r) => r[v].match).length, rs.length)} | ` +
      `year correct ${pct(withYear.filter((r) => r[v].year === "correct").length, withYear.length)} ` +
      `wrong ${pct(rs.filter((r) => r[v].year === "wrong").length, rs.length)} ` +
      `(alone: correct ${pct(alone.filter((r) => r[v].year === "correct").length, alone.length)}, wrong ${pct(alone.filter((r) => r[v].year === "wrong").length, alone.length)}) | ` +
      `match+wrong year ${rs.filter((r) => r[v].match && r[v].year === "wrong").length} | ` +
      `ms p50 ${q(ms, 0.5)} p90 ${q(ms, 0.9)} max ${Math.max(...ms)}`,
  );
}
