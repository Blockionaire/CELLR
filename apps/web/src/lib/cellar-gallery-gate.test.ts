import { describe, expect, it } from "vitest";
import { cellarGalleryOpenIn, type GalleryEnv } from "./cellar-gallery-gate";

/**
 * Where the Smart Cellar template gallery may be seen. The rule that matters most: a Vercel production deployment
 * is closed whatever is set on it.
 */
const open = (env: GalleryEnv) => cellarGalleryOpenIn(env);
/** What Vercel sets on a deployment (system environment variables exposed, the default). */
const vercel = (kind: "production" | "preview", more: GalleryEnv = {}): GalleryEnv => ({
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: kind,
  VERCEL_TARGET_ENV: kind,
  VERCEL_URL: "cellr-abc123.vercel.app",
  VERCEL_REGION: "fra1",
  ...more,
});
const BOTH = { DESIGN_GALLERY: "1", CELLAR_GALLERY_LOCAL_BUILD: "1" };

describe("local development", () => {
  it("is open, with nothing set", () => {
    expect(open({ NODE_ENV: "development" })).toBe(true);
  });

  it("is open under `vercel dev` and with a preview's or development's variables pulled in", () => {
    expect(open({ NODE_ENV: "development", VERCEL: "1", VERCEL_ENV: "development" })).toBe(true);
    expect(open({ NODE_ENV: "development", VERCEL: "1", VERCEL_ENV: "preview" })).toBe(true);
  });

  it("is closed when the environment says it is production, even in `next dev`", () => {
    expect(open({ NODE_ENV: "development", VERCEL: "1", VERCEL_ENV: "production" })).toBe(false);
    expect(open({ NODE_ENV: "development", VERCEL_ENV: "production", ...BOTH })).toBe(false);
  });
});

describe("a Vercel preview deployment", () => {
  it("is closed unless it asked for the gallery", () => {
    expect(open(vercel("preview"))).toBe(false);
    for (const value of ["", "0", "true", "yes", "on"])
      expect(open(vercel("preview", { DESIGN_GALLERY: value })), value).toBe(false);
  });

  it("is open when it asked for it", () => {
    expect(open(vercel("preview", { DESIGN_GALLERY: "1" }))).toBe(true);
    // the target is not always reported
    expect(
      open({ NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview", DESIGN_GALLERY: "1" }),
    ).toBe(true);
  });

  it("the switch for one\'s own machine does not open it", () => {
    expect(open(vercel("preview", { CELLAR_GALLERY_LOCAL_BUILD: "1" }))).toBe(false);
  });

  it("a custom environment (staging, qa) is not a preview", () => {
    expect(open(vercel("preview", { VERCEL_TARGET_ENV: "staging", ...BOTH }))).toBe(false);
  });
});

describe("a Vercel production deployment", () => {
  it("is closed with nothing set", () => {
    expect(open(vercel("production"))).toBe(false);
  });

  it("is closed with DESIGN_GALLERY=1: the flag that opens /design does not open this", () => {
    expect(open(vercel("production", { DESIGN_GALLERY: "1" }))).toBe(false);
  });

  it("is closed with every switch there is, in every combination", () => {
    const switches: GalleryEnv[] = [
      { DESIGN_GALLERY: "1" },
      { CELLAR_GALLERY_LOCAL_BUILD: "1" },
      BOTH,
      { ...BOTH, NODE_ENV: "development" },
      { ...BOTH, NODE_ENV: "test" },
      { ...BOTH, VERCEL_TARGET_ENV: "preview" }, // a target that contradicts the environment
      { ...BOTH, VERCEL_TARGET_ENV: undefined },
      { ...BOTH, VERCEL: undefined, VERCEL_URL: undefined, VERCEL_REGION: undefined },
    ];
    for (const more of switches)
      expect(open(vercel("production", more)), JSON.stringify(more)).toBe(false);
    // and a target of production under any environment name
    expect(open(vercel("preview", { VERCEL_TARGET_ENV: "production", ...BOTH }))).toBe(false);
  });
});

describe("anything else that is hosted", () => {
  it("is closed when it is on Vercel but does not say which environment", () => {
    expect(open({ NODE_ENV: "production", VERCEL: "1", ...BOTH })).toBe(false);
    expect(open({ NODE_ENV: "production", VERCEL_URL: "cellr.vercel.app", ...BOTH })).toBe(false);
  });

  it("is closed on a function host with no Vercel variables at all (system variables not exposed)", () => {
    expect(open({ NODE_ENV: "production", AWS_LAMBDA_FUNCTION_NAME: "fn", ...BOTH })).toBe(false);
    expect(
      open({ NODE_ENV: "production", AWS_EXECUTION_ENV: "AWS_Lambda_nodejs22.x", ...BOTH }),
    ).toBe(false);
  });

  it("is closed for an environment name it does not know", () => {
    expect(open({ NODE_ENV: "production", VERCEL_ENV: "canary", ...BOTH })).toBe(false);
  });
});

describe("a production build on one\'s own machine (the browser tests)", () => {
  it("is closed with nothing set, and with DESIGN_GALLERY=1 alone", () => {
    expect(open({ NODE_ENV: "production" })).toBe(false);
    expect(open({ NODE_ENV: "production", DESIGN_GALLERY: "1" })).toBe(false);
    expect(open({ NODE_ENV: "production", CELLAR_GALLERY_LOCAL_BUILD: "1" })).toBe(false);
    expect(open({})).toBe(false);
  });

  it("is open with both switches", () => {
    expect(open({ NODE_ENV: "production", ...BOTH })).toBe(true);
    expect(open({ NODE_ENV: "test", ...BOTH })).toBe(true);
  });
});
