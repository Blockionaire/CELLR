import { describe, expect, it } from "vitest";
import { cellarGalleryOpenIn } from "./cellar-gallery-gate";
import { smartCellarAccessIn } from "./smart-cellar-gate";
import { internalPreviewIn, smartCellarRendererOpenIn } from "./smart-cellar-renderer-gate";

const READS = { reads: true, writes: false };
const WRITES = { reads: true, writes: true };
const CLOSED = { reads: false, writes: false };
const ON = { CELLR_SMART_CELLAR_3D: "1" };

const VERCEL_PRODUCTION = { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" };
const VERCEL_PREVIEW = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_TARGET_ENV: "preview",
};
const UNMARKED_PRODUCTION = { NODE_ENV: "production" };
const NEXT_DEV = { NODE_ENV: "development" };

describe("the product renderer's gate", () => {
  it("is off by default, everywhere, whatever the API may do", () => {
    for (const env of [VERCEL_PRODUCTION, VERCEL_PREVIEW, UNMARKED_PRODUCTION, NEXT_DEV, {}])
      for (const api of [READS, WRITES, CLOSED])
        expect(smartCellarRendererOpenIn(env, api)).toBe(false);
  });

  it("opens in next dev and on a Vercel preview, only when asked for with exactly 1", () => {
    for (const env of [
      NEXT_DEV,
      VERCEL_PREVIEW,
      { ...VERCEL_PREVIEW, VERCEL_TARGET_ENV: undefined },
    ])
      expect(smartCellarRendererOpenIn({ ...env, ...ON }, READS)).toBe(true);
    for (const value of ["", "0", "true", "on", "yes", "all", " 1", "1 ", "2"])
      expect(
        smartCellarRendererOpenIn({ ...NEXT_DEV, CELLR_SMART_CELLAR_3D: value }, READS),
        JSON.stringify(value),
      ).toBe(false);
  });

  it("NEVER opens on production, whatever is set", () => {
    for (const env of [
      VERCEL_PRODUCTION,
      { ...VERCEL_PREVIEW, VERCEL_TARGET_ENV: "production" },
      { ...NEXT_DEV, VERCEL_ENV: "production" },
      { ...NEXT_DEV, VERCEL_TARGET_ENV: "production" },
    ])
      for (const api of [READS, WRITES])
        expect(smartCellarRendererOpenIn({ ...env, ...ON }, api), JSON.stringify(env)).toBe(false);
  });

  it("stays closed where the deployment cannot be told: an unmarked production build, a custom environment, a test run", () => {
    for (const env of [
      UNMARKED_PRODUCTION,
      { ...VERCEL_PREVIEW, VERCEL_TARGET_ENV: "staging" },
      { NODE_ENV: "production", VERCEL: "1" },
      { NODE_ENV: "production", VERCEL_ENV: "development" },
      { NODE_ENV: "test" },
      {},
    ]) {
      expect(internalPreviewIn(env), JSON.stringify(env)).toBe(false);
      expect(smartCellarRendererOpenIn({ ...env, ...ON }, WRITES), JSON.stringify(env)).toBe(false);
    }
  });

  it("no combination of other settings opens it on a production build", () => {
    const names = [
      "VERCEL",
      "DESIGN_GALLERY",
      "CELLR_FEATURES",
      "CELLR_SMART_CELLAR",
      "CELLAR_GALLERY_LOCAL_BUILD",
      "CI",
    ];
    for (let mask = 0; mask < 1 << names.length; mask++) {
      const env: Record<string, string> = { NODE_ENV: "production", ...ON };
      names.forEach((name, bit) => {
        if (mask & (1 << bit))
          env[name] =
            name === "CELLR_FEATURES" ? "all" : name === "CELLR_SMART_CELLAR" ? "write" : "1";
      });
      expect(smartCellarRendererOpenIn(env, WRITES)).toBe(false);
      expect(smartCellarRendererOpenIn({ ...env, VERCEL_ENV: "production" }, WRITES)).toBe(false);
    }
  });

  it("needs the Smart Cellar API to read (its data comes from there), and nothing of its permission to write", () => {
    const env = { ...VERCEL_PREVIEW, ...ON };
    expect(smartCellarRendererOpenIn(env, CLOSED)).toBe(false);
    expect(smartCellarRendererOpenIn(env, READS)).toBe(true);
    expect(smartCellarRendererOpenIn(env, WRITES)).toBe(true);
    // with the real API switch: "read" is enough, and the renderer opening does not open writes
    const reading = { ...env, CELLR_SMART_CELLAR: "read" };
    expect(smartCellarRendererOpenIn(reading, smartCellarAccessIn(reading))).toBe(true);
    expect(smartCellarAccessIn(reading).writes).toBe(false);
    // and the API writing does not open the renderer
    const writing = { ...VERCEL_PREVIEW, CELLR_SMART_CELLAR: "write" };
    expect(smartCellarRendererOpenIn(writing, smartCellarAccessIn(writing))).toBe(false);
  });

  it("is independent of the design gallery's gate, both ways", () => {
    // the gallery open, the renderer not asked for: closed
    const gallery = { ...VERCEL_PREVIEW, DESIGN_GALLERY: "1" };
    expect(cellarGalleryOpenIn(gallery)).toBe(true);
    expect(smartCellarRendererOpenIn(gallery, READS)).toBe(false);
    // the renderer asked for, the gallery not: the renderer opens and the gallery stays closed
    const renderer = { ...VERCEL_PREVIEW, ...ON };
    expect(smartCellarRendererOpenIn(renderer, READS)).toBe(true);
    expect(cellarGalleryOpenIn(renderer)).toBe(false);
  });
});
