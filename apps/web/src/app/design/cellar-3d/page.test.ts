import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/design/cellar-gallery", () => ({ CellarGallery: () => null }));

import Page, { generateMetadata } from "./page";

/**
 * The page behind its real gate (lib/cellar-gallery-gate.ts), in the environments it can find itself
 * in. Closed means: "not found", and nothing of the gallery in the answer, its name included.
 */
const VARIABLES = [
  "NODE_ENV",
  "DESIGN_GALLERY",
  "CELLAR_GALLERY_LOCAL_BUILD",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_TARGET_ENV",
  "VERCEL_URL",
  "VERCEL_REGION",
  "VERCEL_DEPLOYMENT_ID",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_EXECUTION_ENV",
];
/** The environment of the test, replaced: only what a case names is set. (NODE_ENV stays "test" unless named.) */
function environment(set: Record<string, string>) {
  for (const name of VARIABLES) if (name !== "NODE_ENV") vi.stubEnv(name, undefined);
  for (const [name, value] of Object.entries(set)) vi.stubEnv(name, value);
}
const open = () =>
  Page({ searchParams: Promise.resolve({ template: "diamond_bins", rows: ["3", "4"] }) });
const NOT_FOUND = { digest: expect.stringContaining("404") };
const CLOSED_METADATA = { robots: { index: false, follow: false } };
const VERCEL_PRODUCTION = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_TARGET_ENV: "production",
};
const VERCEL_PREVIEW = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview" };

describe("/design/cellar-3d", () => {
  beforeEach(() => environment({}));
  afterEach(() => vi.unstubAllEnvs());

  it("local development: shows the picture the address asks for", async () => {
    environment({ NODE_ENV: "development" });
    const element = (await open()) as { props: { initial: { template: string; rows: number } } };
    expect(element.props.initial).toMatchObject({ template: "diamond_bins", rows: 3 });
    expect(generateMetadata()).toEqual({ title: "Storage templates", ...CLOSED_METADATA });
  });

  it("a Vercel preview that asked for it: open", async () => {
    environment({ ...VERCEL_PREVIEW, DESIGN_GALLERY: "1" });
    await expect(open()).resolves.toBeTruthy();
    expect(generateMetadata()).toMatchObject({ title: "Storage templates" });
  });

  it("a Vercel preview that did not ask: not found", async () => {
    environment(VERCEL_PREVIEW);
    await expect(open()).rejects.toMatchObject(NOT_FOUND);
    expect(generateMetadata()).toEqual(CLOSED_METADATA);
  });

  it("Vercel production: not found, and DESIGN_GALLERY=1 does not change that", async () => {
    environment(VERCEL_PRODUCTION);
    await expect(open()).rejects.toMatchObject(NOT_FOUND);
    environment({ ...VERCEL_PRODUCTION, DESIGN_GALLERY: "1" });
    await expect(open()).rejects.toMatchObject(NOT_FOUND);
    // closed: not even its name is in the answer
    expect(generateMetadata()).toEqual(CLOSED_METADATA);
  });

  it("Vercel production: not found with every switch set at once", async () => {
    environment({ ...VERCEL_PRODUCTION, DESIGN_GALLERY: "1", CELLAR_GALLERY_LOCAL_BUILD: "1" });
    await expect(open()).rejects.toMatchObject(NOT_FOUND);
    environment({ ...VERCEL_PRODUCTION, DESIGN_GALLERY: "1", NODE_ENV: "development" });
    await expect(open()).rejects.toMatchObject(NOT_FOUND);
    expect(generateMetadata()).toEqual(CLOSED_METADATA);
  });

  it("a production build anywhere else: not found with DESIGN_GALLERY=1 alone", async () => {
    environment({ DESIGN_GALLERY: "1" });
    await expect(open()).rejects.toMatchObject(NOT_FOUND);
    expect(generateMetadata()).toEqual(CLOSED_METADATA);
  });

  it("a production build with no Vercel marker: not found for every combination of gallery flags", async () => {
    for (const flags of [
      {},
      { DESIGN_GALLERY: "1" },
      { CELLAR_GALLERY_LOCAL_BUILD: "1" },
      { DESIGN_GALLERY: "1", CELLAR_GALLERY_LOCAL_BUILD: "1" },
    ])
      for (const mode of ["production", "test"]) {
        environment({ NODE_ENV: mode, ...flags });
        await expect(open(), `${mode} ${JSON.stringify(flags)}`).rejects.toMatchObject(NOT_FOUND);
        expect(generateMetadata(), `${mode} ${JSON.stringify(flags)}`).toEqual(CLOSED_METADATA);
      }
  });

  it("the browser tests\' own server declares itself a Vercel preview, and is open as one", async () => {
    // what playwright.config.ts sets on its third server
    environment({ ...VERCEL_PREVIEW, DESIGN_GALLERY: "1" });
    await expect(open()).resolves.toBeTruthy();
  });

  it("is never for search engines, open or closed", () => {
    environment({ NODE_ENV: "development" });
    expect(generateMetadata().robots).toEqual({ index: false, follow: false });
    environment(VERCEL_PRODUCTION);
    expect(generateMetadata().robots).toEqual({ index: false, follow: false });
  });
});

describe("the design-system page keeps its own gate", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("/design is still opened by DESIGN_GALLERY=1 alone, as before this sprint", async () => {
    const { isDesignGalleryEnabled } = await import("@/server/env");
    environment({ DESIGN_GALLERY: "1" });
    expect(isDesignGalleryEnabled()).toBe(true);
    environment({});
    expect(isDesignGalleryEnabled()).toBe(false);
    environment({ NODE_ENV: "development" });
    expect(isDesignGalleryEnabled()).toBe(true);
  });
});
