import { afterEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ open: false }));
vi.mock("@/features/design/cellar-gallery", () => ({ CellarGallery: () => null }));
vi.mock("@/server/env", async (original) => ({
  ...(await original<typeof import("@/server/env")>()),
  isDesignGalleryEnabled: () => gate.open,
}));

import Page, { metadata } from "./page";

/**
 * The template gallery is a workbench, not a product screen: outside development it exists only where
 * DESIGN_GALLERY=1 is set (a preview deployment). Everywhere else the address answers "not found".
 */
describe("/design/cellar-3d", () => {
  afterEach(() => vi.unstubAllEnvs());
  const open = () =>
    Page({ searchParams: Promise.resolve({ template: "diamond_bins", rows: ["3", "4"] }) });

  it("answers 'not found' where the design gallery is switched off", async () => {
    gate.open = false;
    await expect(open()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("shows the picture the address asks for where it is switched on", async () => {
    gate.open = true;
    const element = (await open()) as { props: { initial: { template: string; rows: number } } };
    expect(element.props.initial).toMatchObject({ template: "diamond_bins", rows: 3 });
  });

  it("is switched on in development, and in production only by DESIGN_GALLERY=1", async () => {
    const { isDesignGalleryEnabled } =
      await vi.importActual<typeof import("@/server/env")>("@/server/env");
    vi.stubEnv("NODE_ENV", "production");
    for (const value of ["", "0", "true", "yes"]) {
      vi.stubEnv("DESIGN_GALLERY", value);
      expect(isDesignGalleryEnabled(), `DESIGN_GALLERY=${value}`).toBe(false);
    }
    vi.stubEnv("DESIGN_GALLERY", "1");
    expect(isDesignGalleryEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DESIGN_GALLERY", "");
    expect(isDesignGalleryEnabled()).toBe(true);
  });

  it("is not for search engines", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
