/**
 * Scan eval: reads your own label photos with the app's real label reader and reports how often it is right.
 *
 *   pnpm scan:eval                      (see eval/scan/README.md and docs/SCAN-EVAL.md)
 *
 * It calls the production code (`createScanService`: same prompt, same strict schema, same plausibility checks)
 * and only replaces what has nothing to do with reading: storage, the budget and the cellar are stubbed out.
 * Settings come from the environment exactly like the app: OPENAI_API_KEY, AI_MODEL_VISION, AI_BASE_URL.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { IMAGE_LIMITS, sanitizeJpeg } from "@cellr/domain";
import { getLlmProvider } from "@/server/ai";
import { LABEL_EXTRACTION_VERSION } from "@/server/ai/prompts/label-extraction";
import { getAiEnv } from "@/server/env";
import { createScanService } from "@/server/scans/service";
import { formatReport, summarize, type PhotoOutcome } from "./report";
import {
  DEFAULT_THRESHOLD,
  ExpectedFileError,
  lookupExpected,
  parseExpectedCsv,
  parseExpectedJson,
  scorePhoto,
  type Expected,
  type Got,
} from "./score";

const PHOTO_FILE = /\.(jpe?g|png|webp)$/i;

const { values: args } = parseArgs({
  options: {
    limit: { type: "string" },
    only: { type: "string" },
    concurrency: { type: "string", default: "3" },
    threshold: { type: "string", default: String(DEFAULT_THRESHOLD) },
    "min-right-wine": { type: "string" },
  },
  allowPositionals: true,
});

const repoRoot = path.resolve(import.meta.dirname, "../..");
const dataDir = process.env.SCAN_EVAL_DIR
  ? path.resolve(process.env.INIT_CWD ?? process.cwd(), process.env.SCAN_EVAL_DIR)
  : path.join(repoRoot, "eval", "scan");
const photosDir = path.join(dataDir, "photos");
const shown = (p: string) => path.relative(repoRoot, p) || p;

function skip(message: string): never {
  console.log(`scan:eval skipped: ${message}`);
  process.exit(0);
}

function fail(message: string): never {
  console.error(`scan:eval: ${message}`);
  process.exit(1);
}

function number(name: string, text: string | undefined, min: number, max: number): number | null {
  if (text === undefined) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < min || n > max)
    fail(`--${name} must be a number from ${min} to ${max}.`);
  return n;
}

async function listPhotos(): Promise<string[]> {
  if (!existsSync(photosDir)) return [];
  const entries = await readdir(photosDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && !e.name.startsWith(".") && PHOTO_FILE.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

async function loadExpected(): Promise<Map<string, Expected>> {
  const json = path.join(dataDir, "expected.json");
  const csv = path.join(dataDir, "expected.csv");
  try {
    if (existsSync(json)) return parseExpectedJson(JSON.parse(await readFile(json, "utf8")));
    if (existsSync(csv)) return parseExpectedCsv(await readFile(csv, "utf8"));
  } catch (error) {
    if (error instanceof ExpectedFileError) fail(`${error.message}`);
    if (error instanceof SyntaxError) fail(`expected.json is not valid JSON (${error.message}).`);
    throw error;
  }
  return fail(
    `no expected values found. Create ${shown(json)} (see eval/scan/expected.example.json) or expected.csv.`,
  );
}

/** What the phone does before sending: upright, longest side 1600 px, on white, JPEG at 85%. */
async function prepare(file: string): Promise<Uint8Array> {
  const bytes = await sharp(await readFile(path.join(photosDir, file)))
    .rotate()
    .resize({
      width: IMAGE_LIMITS.photoEdge,
      height: IMAGE_LIMITS.photoEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
  return new Uint8Array(bytes);
}

type Provider = NonNullable<ReturnType<typeof getLlmProvider>>;

async function evaluate(
  file: string,
  expected: Expected,
  provider: Provider,
  threshold: number,
): Promise<{ outcome: PhotoOutcome; got: Got | null }> {
  const base = { file, tokensIn: null, tokensOut: null, latencyMs: null };
  try {
    const photo = await prepare(file);
    let usage: { tokensIn: number; tokensOut: number; latencyMs: number } | null = null;
    const service = createScanService({
      // The real service keeps the photo first; here it is only cleaned the same way and handed back.
      images: {
        uploadWithPhoto: async (input) => {
          const clean = sanitizeJpeg(input.photo, IMAGE_LIMITS.photoBytes);
          if (!clean.ok) throw new Error(`photo refused: ${clean.reason}`);
          return {
            image: {
              id: "eval",
              side: input.side,
              blurColor: null,
              width: clean.width,
              height: clean.height,
            },
            photo: clean.bytes,
          };
        },
      },
      wines: async () => [],
      householdId: async () => "eval",
      llm: provider,
      spendScan: async () => {},
      recordUsage: async (entry) => {
        usage = entry.usage;
      },
    });
    const result = await service.scan({ photo });
    const facts = result.facts;
    const got: Got | null = facts && {
      producer: facts.producer,
      name: facts.name,
      year: facts.year,
      type: facts.type,
      countryCode: facts.countryCode,
      region: facts.region,
      appellation: facts.appellation,
      grapes: facts.grapes,
    };
    const used = usage as { tokensIn: number; tokensOut: number; latencyMs: number } | null;
    const status = facts ? "read" : result.reason === "ai-down" ? "error" : "unread";
    return {
      got,
      outcome: {
        file,
        status,
        reason: result.reason,
        fields: scorePhoto(expected, got, threshold),
        latencyMs: used?.latencyMs ?? null,
        tokensIn: used && used.tokensIn > 0 ? used.tokensIn : null,
        tokensOut: used && used.tokensOut > 0 ? used.tokensOut : null,
      },
    };
  } catch (error) {
    return {
      got: null,
      outcome: {
        ...base,
        status: "error",
        reason: error instanceof Error ? error.message : String(error),
        fields: scorePhoto(expected, null, threshold),
      },
    };
  }
}

async function main() {
  const photos = await listPhotos();
  if (photos.length === 0)
    skip(
      `no photos found in ${shown(photosDir)}. Add 30-50 label photos (jpg, png or webp) and an expected.json; ` +
        "see eval/scan/README.md.",
    );

  const provider = getLlmProvider();
  if (!provider)
    skip(
      `${photos.length} photos found, but OPENAI_API_KEY is not set in the environment. ` +
        "Set it for this one command, e.g. OPENAI_API_KEY=... pnpm scan:eval (never write it in a file).",
    );

  const expected = await loadExpected();
  const concurrency = number("concurrency", args.concurrency, 1, 10) ?? 3;
  const threshold = number("threshold", args.threshold, 0.1, 1) ?? DEFAULT_THRESHOLD;
  const minRightWine = number("min-right-wine", args["min-right-wine"], 0, 1);
  const limit = number("limit", args.limit, 1, 10_000);

  const unlisted = photos.filter((f) => !lookupExpected(expected, f));
  let work = photos.filter((f) => lookupExpected(expected, f));
  if (args.only) work = work.filter((f) => f.toLowerCase().includes(args.only!.toLowerCase()));
  if (limit) work = work.slice(0, limit);
  if (work.length === 0)
    fail(
      `none of the ${photos.length} photos has an entry in the expected-values file. ` +
        'Use the photo file names as keys, e.g. "IMG_0001.jpg".',
    );
  if (unlisted.length > 0)
    console.warn(
      `Not read (no expected values): ${unlisted.length} photos, e.g. ${unlisted.slice(0, 3).join(", ")}`,
    );
  const missing = [...expected.keys()].filter(
    (key) => !photos.some((f) => lookupExpected(new Map([[key, {}]]), f)),
  );
  if (missing.length > 0)
    console.warn(`Expected values without a photo: ${missing.slice(0, 5).join(", ")}`);

  const ai = getAiEnv();
  console.error(
    `Reading ${work.length} photos with ${ai.visionModel} (${concurrency} at a time). One vision call each.`,
  );

  const done: Array<{ outcome: PhotoOutcome; got: Got | null; expected: Expected }> = new Array(
    work.length,
  );
  let next = 0;
  let finished = 0;
  const worker = async () => {
    for (let i = next++; i < work.length; i = next++) {
      const file = work[i]!;
      const entry = lookupExpected(expected, file)!;
      const { outcome, got } = await evaluate(file, entry, provider, threshold);
      done[i] = { outcome, got, expected: entry };
      finished++;
      const wrong = outcome.fields.filter((f) => !f.ok).length;
      console.error(
        `[${finished}/${work.length}] ${file}  ${outcome.status}${wrong ? `, ${wrong} wrong` : ", all right"}` +
          (outcome.latencyMs ? `  ${(outcome.latencyMs / 1000).toFixed(1)}s` : ""),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, work.length) }, worker));

  const summary = summarize(done.map((d) => d.outcome));
  const meta = { model: ai.visionModel, prompt: LABEL_EXTRACTION_VERSION };
  console.log(`\n${formatReport(summary, meta)}`);

  const reportPath = path.join(dataDir, "report.json");
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        ...meta,
        threshold,
        summary,
        photos: done.map((d) => ({ ...d.outcome, expected: d.expected, got: d.got })),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nFull report: ${shown(reportPath)} (stays on your machine; it is never committed)`);

  if (minRightWine !== null && (summary.identified.rate ?? 0) < minRightWine) {
    console.error(`Right-wine rate is below the required ${minRightWine}.`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  // Never print a request or the key: the message of an error from our own code is enough.
  fail(error instanceof Error ? error.message : "unexpected error");
});
