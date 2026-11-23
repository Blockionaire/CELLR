import { labelLines, vintageFromLabel } from "@cellr/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The on-device label reader's time budget: decoding the photo, waiting behind another photo, reading and stopping
 * the reader all stay inside it, and whatever finishes after it is dropped without leaks or unhandled errors.
 * (tesseract.js and the browser's image decoding are stand-ins here; vitest fails on any unhandled rejection.)
 */

const worker = {
  setParameters: vi.fn(async (params: Record<string, string>) => ({ params })),
  recognize: vi.fn(),
  // never settles: stopping the reader must not hold the photo up
  terminate: vi.fn(() => new Promise<never>(() => {})),
};
vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(async () => worker),
  OEM: { LSTM_ONLY: 1 },
  PSM: { SPARSE_TEXT: "11", SINGLE_BLOCK: "6" },
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
  worker.setParameters.mockClear();
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

/** A read as tesseract.js returns it with `blocks: true`: the text and its lines with where they are. */
const page = (lines: { text: string; at: number }[]) => ({
  data: {
    text: lines.map((l) => l.text).join("\n") + "\n",
    blocks: [
      {
        paragraphs: [
          {
            lines: lines.map((l) => ({
              text: `${l.text}\n`,
              bbox: { x0: 500, y0: l.at, x1: 620, y1: l.at + 40 },
            })),
          },
        ],
      },
    ],
  },
});
const LABEL = [
  { text: "DOMAINE ALPHA", at: 300 },
  { text: "Cuvée Silex", at: 400 },
];
const yearOf = (text: string | null | undefined) =>
  vintageFromLabel(labelLines(text ?? ""), null, new Date("2026-06-01T00:00:00Z"));

describe("a year printed alone on its line is read a second time", () => {
  it("knows which lines may be a lone year", async () => {
    const { loneDigits } = await import("./ocr");
    for (const t of ["2019", "2018", "20119", "20H", "Z0EE)", "750"])
      expect(loneDigits(t)).toBe(true);
    for (const t of ["Cuvée Silex", "Millésime 2019", "75 cl", "2", "ALPHA", "2019201920"])
      expect(loneDigits(t)).toBe(false);
  });

  it("reads the line again together with its neighbours, within the picture", async () => {
    const { aroundLine } = await import("./ocr");
    expect(aroundLine({ x0: 500, y0: 600, x1: 620, y1: 640 }, 1280, 960)).toEqual({
      left: 180,
      top: 480,
      width: 760,
      height: 280,
    });
    // near the edge: cut off at the picture's border
    expect(aroundLine({ x0: 10, y0: 20, x1: 130, y1: 60 }, 300, 200)).toEqual({
      left: 0,
      top: 0,
      width: 300,
      height: 180,
    });
  });

  it("a misread year and the second look disagree: no year rather than a wrong one", async () => {
    const ocr = await loadReader();
    worker.recognize
      .mockResolvedValueOnce(page([...LABEL, { text: "2018", at: 500 }]))
      .mockResolvedValueOnce(
        page([
          { text: "Cuvée Silex", at: 400 },
          { text: "2019", at: 500 },
        ]),
      );
    const reading = await ocr.readLabelText(new Blob(["jpeg"]), 10_000);
    expect(worker.recognize).toHaveBeenCalledTimes(2);
    // the second look reads a block around the line, then the next photo is read sparse again
    expect(worker.recognize.mock.calls[1]).toEqual([
      expect.anything(),
      { rectangle: { left: 180, top: 380, width: 760, height: 280 } },
      { text: true, blocks: true },
    ]);
    expect(worker.setParameters.mock.calls.map(([p]) => p)).toEqual([
      { tessedit_pageseg_mode: "11" },
      { tessedit_pageseg_mode: "6" },
    ]);
    expect(reading?.text).toBe("DOMAINE ALPHA\nCuvée Silex\n2018\n2019");
    expect(yearOf(reading?.text)).toBeNull();
  });

  it("a garbled year is read right the second time; a year read the same twice stays", async () => {
    const ocr = await loadReader();
    worker.recognize
      .mockResolvedValueOnce(page([...LABEL, { text: "20119", at: 500 }]))
      .mockResolvedValueOnce(page([{ text: "2019", at: 500 }]));
    expect(yearOf((await ocr.readLabelText(new Blob(["one"]), 10_000))?.text)).toBe(2019);
    worker.recognize
      .mockResolvedValueOnce(page([...LABEL, { text: "2019", at: 500 }]))
      .mockResolvedValueOnce(page([{ text: "2019", at: 500 }]));
    expect(yearOf((await ocr.readLabelText(new Blob(["two"]), 10_000))?.text)).toBe(2019);
  });

  it("a label without a lone digit line is read once", async () => {
    const ocr = await loadReader();
    worker.recognize.mockResolvedValueOnce(page([...LABEL, { text: "Millésime 2019", at: 500 }]));
    const reading = await ocr.readLabelText(new Blob(["jpeg"]), 10_000);
    expect(worker.recognize).toHaveBeenCalledTimes(1);
    expect(yearOf(reading?.text)).toBe(2019);
  });

  it("at most two lines are read again", async () => {
    const ocr = await loadReader();
    worker.recognize.mockResolvedValueOnce(
      page([
        ...LABEL,
        { text: "1855", at: 500 },
        { text: "2019", at: 600 },
        { text: "750", at: 700 },
      ]),
    );
    await ocr.readLabelText(new Blob(["jpeg"]), 10_000);
    expect(worker.recognize).toHaveBeenCalledTimes(3);
  });

  it("no second look when the budget would not hold it: the first reading is kept", async () => {
    const ocr = await loadReader();
    worker.recognize.mockImplementationOnce(async () => {
      await sleep(90); // more than the 60 ms the budget leaves after it
      return page([...LABEL, { text: "2019", at: 500 }]);
    });
    const reading = await ocr.readLabelText(new Blob(["jpeg"]), BUDGET);
    expect(worker.recognize).toHaveBeenCalledTimes(1);
    expect(reading?.text).toBe("DOMAINE ALPHA\nCuvée Silex\n2019");
  });

  it("a second look that runs past the budget ends the read like any slow read", async () => {
    const ocr = await loadReader();
    const slow = later<ReturnType<typeof page>>();
    worker.recognize
      .mockResolvedValueOnce(page([...LABEL, { text: "2018", at: 500 }]))
      .mockImplementationOnce(() => slow.promise);
    const { value, ms } = await timed(ocr.readLabelText(new Blob(["jpeg"]), BUDGET));
    expect(value).toMatchObject({ text: null });
    expect(ms).toBeLessThan(BUDGET + 100);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    slow.reject(new Error("terminated"));
    await sleep(20);
  });
});
