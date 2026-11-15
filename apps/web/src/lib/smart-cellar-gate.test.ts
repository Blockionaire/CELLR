import { describe, expect, it } from "vitest";
import { smartCellarAccessIn, writesMayOpenIn } from "./smart-cellar-gate";

const VERCEL_PRODUCTION = { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" };
const VERCEL_PREVIEW = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_TARGET_ENV: "preview",
};
const UNMARKED_PRODUCTION = { NODE_ENV: "production" };
const NEXT_DEV = { NODE_ENV: "development" };

describe("the Smart Cellar API switch", () => {
  it("is closed when nothing is set, everywhere", () => {
    for (const env of [VERCEL_PRODUCTION, VERCEL_PREVIEW, UNMARKED_PRODUCTION, NEXT_DEV, {}])
      expect(smartCellarAccessIn(env)).toEqual({ reads: false, writes: false });
  });

  it("anything but read or write is closed (fails closed)", () => {
    for (const value of ["", "off", "on", "1", "true", "all", "reads", "read,write", "WRITE!"])
      expect(smartCellarAccessIn({ ...NEXT_DEV, CELLR_SMART_CELLAR: value })).toEqual({
        reads: false,
        writes: false,
      });
  });

  it("read opens reading anywhere, and never writing", () => {
    for (const env of [VERCEL_PRODUCTION, VERCEL_PREVIEW, UNMARKED_PRODUCTION, NEXT_DEV])
      expect(smartCellarAccessIn({ ...env, CELLR_SMART_CELLAR: " Read " })).toEqual({
        reads: true,
        writes: false,
      });
  });

  it("write opens writing in next dev and on a Vercel preview", () => {
    for (const env of [
      NEXT_DEV,
      VERCEL_PREVIEW,
      { ...VERCEL_PREVIEW, VERCEL_TARGET_ENV: undefined },
    ])
      expect(smartCellarAccessIn({ ...env, CELLR_SMART_CELLAR: "write" })).toEqual({
        reads: true,
        writes: true,
      });
  });

  it("write NEVER opens writing on production: Vercel production, an unmarked production build, a production target", () => {
    for (const env of [
      VERCEL_PRODUCTION,
      UNMARKED_PRODUCTION,
      { ...VERCEL_PREVIEW, VERCEL_TARGET_ENV: "production" },
      { ...NEXT_DEV, VERCEL_ENV: "production" },
      { ...NEXT_DEV, VERCEL_TARGET_ENV: "production" },
      // a custom Vercel environment (staging) is not a preview for this purpose
      { ...VERCEL_PREVIEW, VERCEL_TARGET_ENV: "staging" },
      // unit tests and anything else that is not `next dev`
      { NODE_ENV: "test" },
      {},
    ])
      expect(
        smartCellarAccessIn({ ...env, CELLR_SMART_CELLAR: "write" }),
        JSON.stringify(env),
      ).toEqual({
        reads: true,
        writes: false,
      });
  });

  it("no combination of other variables opens writes on a production build", () => {
    const names = [
      "VERCEL",
      "DESIGN_GALLERY",
      "CELLR_FEATURES",
      "CELLAR_GALLERY_LOCAL_BUILD",
      "CI",
    ];
    for (let mask = 0; mask < 1 << names.length; mask++) {
      const env: Record<string, string> = { NODE_ENV: "production", CELLR_SMART_CELLAR: "write" };
      names.forEach((name, bit) => {
        if (mask & (1 << bit)) env[name] = name === "CELLR_FEATURES" ? "all" : "1";
      });
      expect(writesMayOpenIn(env)).toBe(false);
      expect(writesMayOpenIn({ ...env, VERCEL_ENV: "production" })).toBe(false);
    }
  });
});
