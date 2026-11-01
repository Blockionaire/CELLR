import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The on-device label reader's time budget: decoding the photo, waiting behind another photo, reading and stopping
 * the reader all stay inside it, and whatever finishes after it is dropped without leaks or unhandled errors.
 * (tesseract.js and the browser's image decoding are stand-ins here; vitest fails on any unhandled rejection.)
 */

const worker = {
  setParameters: vi.fn(async () => ({})),
  recognize: vi.fn(),
  // never settles: stopping the reader must not hold the photo up
  terminate: vi.fn(() => new Promise<never>(() => {})),
};
vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(async () => worker),
  OEM: { LSTM_ONLY: 1 },
  PSM: { SPARSE_TEXT: "11" },
}));

const BUDGET = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const later = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const bitmap = () => ({ width: 1600, height: 1200, close: vi.fn() });
const decode = vi.fn<(photo: Blob) => Promise<ReturnType<typeof bitmap>>>();

async function loadReader() {
  vi.resetModules();
  const ocr = await import("./ocr");
  await ocr.warmOcr();
  expect(ocr.ocrStatus()).toBe("ready");
  return ocr;
}

async function timed<T>(work: Promise<T>) {
  const started = performance.now();
  const value = await work;
  return { value, ms: performance.now() - started };
}

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("Worker", class {});
  vi.stubGlobal("document", {
    documentElement: { dataset: {} },
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) }),
  });
  vi.stubGlobal("createImageBitmap", decode);
  decode.mockReset().mockImplementation(async () => bitmap());
  worker.recognize
    .mockReset()
    .mockResolvedValue({ data: { text: "DOMAINE ALPHA\nCuvée Silex\n" } });
  worker.terminate.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("reading a label on the phone, within its budget", () => {
  it("reads the text when everything is quick", async () => {
    const ocr = await loadReader();
    const reading = await ocr.readLabelText(new Blob(["jpeg"]), BUDGET);
    expect(reading).toMatchObject({ text: "DOMAINE ALPHA\nCuvée Silex" });
    expect(reading!.ms).toBeLessThan(BUDGET);
  });

  it("a slow image decode ends at the budget; when it finishes later, nothing is read and nothing leaks", async () => {
    const ocr = await loadReader();
    const slow = later<ReturnType<typeof bitmap>>();
    decode.mockImplementationOnce(() => slow.promise);
    const { value, ms } = await timed(ocr.readLabelText(new Blob(["jpeg"]), BUDGET));
    expect(value).toMatchObject({ text: null });
    expect(ms).toBeGreaterThanOrEqual(BUDGET - 5);
    expect(ms).toBeLessThan(BUDGET + 100);
    // the decode completes after the photo went on
    const late = bitmap();
    slow.resolve(late);
    await sleep(20);
    expect(late.close).toHaveBeenCalled(); // its memory is let go
    expect(worker.recognize).not.toHaveBeenCalled(); // and it never reaches the reader
    // a slow decode is not a slow reader: the next photo is read as usual
    expect(ocr.ocrStatus()).toBe("ready");
    expect((await ocr.readLabelText(new Blob(["jpeg"]), BUDGET))?.text).toContain("ALPHA");
  });

  it("a decode that fails after the budget raises nothing", async () => {
    const ocr = await loadReader();
    const slow = later<ReturnType<typeof bitmap>>();
    decode.mockImplementationOnce(() => slow.promise);
    expect(await ocr.readLabelText(new Blob(["jpeg"]), BUDGET)).toMatchObject({ text: null });
    slow.reject(new Error("decode failed"));
    await sleep(20);
    expect(worker.recognize).not.toHaveBeenCalled();
  });

  it("a slow read ends at the budget, stops the reader without waiting for it, and is not tried again", async () => {
    const ocr = await loadReader();
    const slow = later<{ data: { text: string } }>();
    worker.recognize.mockImplementationOnce(() => slow.promise);
    const { value, ms } = await timed(ocr.readLabelText(new Blob(["jpeg"]), BUDGET));
    expect(value).toMatchObject({ text: null });
    expect(ms).toBeLessThan(BUDGET + 100); // terminate() never settles, and is not waited for
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(ocr.ocrStatus()).toBe("failed");
    // the read fails late (the reader was stopped): nothing is raised
    slow.reject(new Error("terminated"));
    await sleep(20);
    expect(await ocr.readLabelText(new Blob(["jpeg"]), BUDGET)).toBeNull();
  });

  it("a photo still queued behind another when its budget ends goes on without text, and is never read", async () => {
    const ocr = await loadReader();
    const first = later<{ data: { text: string } }>();
    worker.recognize.mockImplementationOnce(() => first.promise);
    const one = ocr.readLabelText(new Blob(["one"]), 10_000);
    await sleep(10);
    const { value, ms } = await timed(ocr.readLabelText(new Blob(["two"]), BUDGET));
    expect(value).toMatchObject({ text: null });
    expect(ms).toBeLessThan(BUDGET + 100);
    first.resolve({ data: { text: "FIRST" } });
    expect((await one)?.text).toBe("FIRST");
    await sleep(20);
    expect(worker.recognize).toHaveBeenCalledTimes(1);
    expect(ocr.ocrStatus()).toBe("ready");
  });

  it("a read that fails at once stops the reader and returns at once", async () => {
    const ocr = await loadReader();
    worker.recognize.mockRejectedValueOnce(new Error("worker crashed"));
    const { value, ms } = await timed(ocr.readLabelText(new Blob(["jpeg"]), BUDGET));
    expect(value).toMatchObject({ text: null });
    expect(ms).toBeLessThan(BUDGET);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
