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
/** Every switch the gallery has ever had. The second one was removed; it is here to pin that it opens nothing. */
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

  it("the removed local-build switch neither opens it nor is needed", () => {
    expect(open(vercel("preview", { CELLAR_GALLERY_LOCAL_BUILD: "1" }))).toBe(false);
    expect(open(vercel("preview", BOTH))).toBe(true);
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

/**
 * Regression (sprint 2A, final review): there used to be a way to open the gallery in a production build that
 * carries no Vercel marker (DESIGN_GALLERY=1 with CELLAR_GALLERY_LOCAL_BUILD=1, meant for the browser tests). The
 * app cannot prove such a place is somebody's own machine, so it must stay closed whatever is set.
 */
describe("a production build with no Vercel marker at all", () => {
  const FLAG_VALUES = [undefined, "", "0", "1", "true", "yes", "on", "preview", "development"];
  /** Everything that has ever been, or could be mistaken for, a gallery switch. */
  const FLAGS = [
    "DESIGN_GALLERY",
    "CELLAR_GALLERY_LOCAL_BUILD",
    "CELLAR_GALLERY",
    "CELLAR_GALLERY_ENABLED",
    "NEXT_PUBLIC_DESIGN_GALLERY",
    "CELLR_FEATURES",
  ];

  it("is closed for every combination of the two switches there have been, at every value", () => {
    let tried = 0;
    for (const design of FLAG_VALUES)
      for (const local of FLAG_VALUES) {
        const env = {
          NODE_ENV: "production",
          DESIGN_GALLERY: design,
          CELLAR_GALLERY_LOCAL_BUILD: local,
        };
        expect(open(env), JSON.stringify(env)).toBe(false);
        tried += 1;
      }
    expect(tried).toBe(FLAG_VALUES.length ** 2);
  });

  it("is closed for every subset of every flag set to 1", () => {
    for (let mask = 0; mask < 2 ** FLAGS.length; mask++) {
      const env: Record<string, string> = { NODE_ENV: "production" };
      FLAGS.forEach((name, bit) => {
        if (mask & (1 << bit)) env[name] = name === "CELLR_FEATURES" ? "all" : "1";
      });
      expect(open(env), JSON.stringify(env)).toBe(false);
    }
  });

  it("is closed whatever NODE_ENV is, except development", () => {
    for (const mode of [
      undefined,
      "",
      "production",
      "test",
      "staging",
      "PRODUCTION",
      "Development",
      "dev",
    ])
      expect(open({ NODE_ENV: mode, ...BOTH }), String(mode)).toBe(false);
    expect(open(BOTH)).toBe(false);
    expect(open({})).toBe(false);
    // the one way in without Vercel: `next dev`
    expect(open({ NODE_ENV: "development" })).toBe(true);
  });

  it("is closed with every other hint of a host one could think of, none of which is Vercel saying 'preview'", () => {
    const hints: GalleryEnv[] = [
      { HOSTNAME: "localhost" },
      { HOST: "127.0.0.1", PORT: "3100" },
      { CI: "true" },
      { PLAYWRIGHT: "1" },
      { NEXT_PUBLIC_VERCEL_ENV: "preview" }, // the public copy is not the system variable
      { VERCEL_GIT_COMMIT_REF: "feature" },
      { AWS_LAMBDA_FUNCTION_NAME: "fn" },
    ];
    for (const hint of hints)
      expect(open({ NODE_ENV: "production", ...BOTH, ...hint }), JSON.stringify(hint)).toBe(false);
  });
});
