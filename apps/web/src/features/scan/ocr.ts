"use client";

import type { Worker as OcrWorker } from "tesseract.js";
import tesseractPackage from "tesseract.js/package.json";

/**
 * READING THE LABEL ON THE PHONE (Sprint S). Before a photo is sent, the phone tries to read the label's printed
 * text itself (tesseract.js: WebAssembly, in a Web Worker, no paid API, nothing leaves the phone but the text). The
 * server looks that text up in the catalogue; only an exact identity skips the vision model.
 *
 * Bounded on purpose:
 * - nothing is loaded until the scan screen asks (and not at all on "save data" connections or without WebAssembly);
 * - the files (≈1.1 MB WebAssembly core + 2.9 MB model, compressed) come from CELLR itself and are cached by the browser (the model
 *   in IndexedDB) after the first time;
 * - a photo waits at most `readBudgetMs` for the text (`loadWaitMs` for a reader still loading). Not ready, too slow,
 *   failed or empty: the photo is sent without text at once and read by the model exactly as before;
 * - a reader that failed to load, or a read that ran out of time, is not tried again during the visit.
 */
export const OCR = {
  /** Where scripts/ocr-assets.mjs puts the files (versioned, so they can be cached for good). */
  base: `/ocr/${tesseractPackage.version}`,
  /** The longest a photo waits for its text (loading included), in milliseconds. */
  readBudgetMs: 2500,
  /** Of that, the longest it waits for a reader that is still loading (the next photo will have it). */
  loadWaitMs: 300,
  /** A load that takes longer than this is given up for the rest of the visit (a stuck network or worker). */
  loadGiveUpMs: 30_000,
  /** Text is read from a copy this size (long edge): enough for label lettering, quick to read. */
  edge: 1280,
} as const;

/** What the phone read: the text (null = nothing usable) and how long it took. Null overall = not tried. */
export interface LabelTextReading {
  text: string | null;
  ms: number;
}

type Status = "idle" | "loading" | "ready" | "failed";
let status: Status = "idle";
/** Also shown as `<html data-ocr="…">`, for support and for the end-to-end tests to wait on. */
function setStatus(next: Status) {
  status = next;
  if (typeof document !== "undefined") document.documentElement.dataset.ocr = next;
}
let loading: Promise<OcrWorker | null> | null = null;

const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());

/** WebAssembly SIMD (Safari 16.4+, recent Chrome/Firefox): the faster core. Same check as wasm-feature-detect. */
function simd(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0,
        253, 15, 253, 98, 11,
      ]),
    );
  } catch {
    return false;
  }
}

/** Whether this browser can run it at all, and the person has not asked to save data. */
export function ocrSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof WebAssembly !== "object" || typeof Worker !== "function") return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !connection?.saveData;
}

/** Starts loading the reader in the background (the scan screen calls this when it opens). Never throws. */
export function warmOcr(): Promise<OcrWorker | null> {
  // A reader that failed to load is not tried again during this visit: no scan pays for it twice.
  if (!ocrSupported() || status === "failed") return Promise.resolve(null);
  if (loading) return loading;
  setStatus("loading");
  const giveUp = setTimeout(() => {
    if (status === "loading") setStatus("failed");
  }, OCR.loadGiveUpMs);
  loading = (async () => {
    try {
      const { createWorker, OEM, PSM } = await import("tesseract.js");
      const worker = await createWorker("eng", OEM.LSTM_ONLY, {
        workerPath: `${OCR.base}/worker.min.js`,
        // the core's glue loads its .wasm from the same folder
        corePath: `${OCR.base}/tesseract-core-${simd() ? "simd-lstm" : "lstm"}.js`,
        langPath: OCR.base,
        gzip: true,
        // a same-origin worker file, not a blob: (stricter browsers and CSPs refuse those)
        workerBlobURL: false,
      });
      // Labels are sparse text in odd places: find whatever text there is, line by line.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      if (ocrStatus() === "failed") {
        // given up meanwhile: do not keep a reader nobody will use
        await worker.terminate().catch(() => {});
        return null;
      }
      setStatus("ready");
      return worker;
    } catch {
      setStatus("failed");
      return null;
    } finally {
      clearTimeout(giveUp);
    }
  })();
  return loading;
}

/** For tests and the scan screen: whether the reader is loaded. */
export const ocrStatus = () => status;

/**
 * Gives the reader up for the rest of the visit: a read that ran out of time means this device (or this moment) is
 * too slow, and every later photo would only wait for nothing. The worker is terminated so it stops using the phone.
 */
async function giveUp(worker: OcrWorker | null) {
  setStatus("failed");
  loading = null;
  await worker?.terminate().catch(() => {});
}

/** One read at a time on the one reader (a batch reads two photos at once): the next waits for the previous. */
let queue: Promise<unknown> = Promise.resolve();

const timeout = (ms: number) =>
  new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), Math.max(0, ms)));

/** Decodes a picture: createImageBitmap where there is one, otherwise an <img> (older Safari). */
async function decode(photo: Blob): Promise<{ source: CanvasImageSource; w: number; h: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(photo);
    return { source: bitmap, w: bitmap.width, h: bitmap.height };
  }
  const url = URL.createObjectURL(photo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A copy of the (prepared: already upright, re-encoded, no camera metadata) photo at most `OCR.edge` long; null when
 * the browser cannot decode it, and the photo then simply goes on without text.
 */
async function shrink(photo: Blob): Promise<HTMLCanvasElement | null> {
  try {
    const { source, w, h } = await decode(photo);
    const scale = Math.min(1, OCR.edge / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
    if ("close" in source && typeof source.close === "function") source.close();
    return canvas;
  } catch {
    return null;
  }
}

/**
 * Reads the label text of a (prepared) photo within the budget. Null when the reader cannot run here at all;
 * otherwise the text (or null when not ready in time, failed or empty) and how long it took.
 */
export async function readLabelText(
  photo: Blob,
  budgetMs: number = OCR.readBudgetMs,
): Promise<LabelTextReading | null> {
  if (!ocrSupported()) return null;
  if (status === "failed") return null;
  const started = now();
  const left = () => budgetMs - (now() - started);
  // A reader still loading is waited for only briefly: this photo goes on without it, the next one will have it.
  const wait = status === "ready" ? left() : Math.min(left(), OCR.loadWaitMs);
  const worker = await Promise.race([warmOcr(), timeout(wait)]);
  if (worker === "timeout" || worker === null)
    return { text: null, ms: Math.round(now() - started) };
  try {
    const image = await shrink(photo);
    if (!image) return { text: null, ms: Math.round(now() - started) };
    let begun = false;
    let dropped = false;
    const job = queue.then(() => {
      if (dropped) return null; // this photo has gone on without its text already
      begun = true;
      return worker.recognize(image);
    });
    queue = job.catch(() => {});
    const result = await Promise.race([job, timeout(left())]);
    if (result === "timeout" || result === null) {
      dropped = true;
      // Still waiting behind another photo: just go on without text. Reading itself was too slow: stop trying.
      if (begun) await giveUp(worker);
      return { text: null, ms: Math.round(now() - started) };
    }
    const text = result.data.text.trim();
    return { text: text === "" ? null : text, ms: Math.round(now() - started) };
  } catch {
    await giveUp(worker);
    return { text: null, ms: Math.round(now() - started) };
  }
}
