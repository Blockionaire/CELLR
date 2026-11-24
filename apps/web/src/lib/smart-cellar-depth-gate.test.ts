import { describe, expect, it } from "vitest";
import { depthGateOpenIn } from "./smart-cellar-depth-gate";
import { PLACEMENT_CLOSED, type PlacementAccess } from "./smart-cellar-placement-gate";

const WRITING: PlacementAccess = { open: true, canWrite: true, depth: false };
const PREVIEW = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview" };

describe("the depth gate (sprint 9): closed by default, never open on production by configuration", () => {
  it("is closed by default everywhere", () => {
    expect(depthGateOpenIn({}, WRITING)).toBe(false);
    expect(depthGateOpenIn(PREVIEW, WRITING)).toBe(false);
    expect(depthGateOpenIn({ NODE_ENV: "development" }, WRITING)).toBe(false);
  });

  it('opens only with exactly "1", on dev or a preview, where placement writes', () => {
    expect(depthGateOpenIn({ ...PREVIEW, CELLR_SMART_CELLAR_DEPTH: "1" }, WRITING)).toBe(true);
    expect(
      depthGateOpenIn({ NODE_ENV: "development", CELLR_SMART_CELLAR_DEPTH: "1" }, WRITING),
    ).toBe(true);
    for (const value of ["true", "on", "yes", " 1", "1 ", "2", ""])
      expect(depthGateOpenIn({ ...PREVIEW, CELLR_SMART_CELLAR_DEPTH: value }, WRITING), value).toBe(
        false,
      );
    expect(depthGateOpenIn({ ...PREVIEW, CELLR_SMART_CELLAR_DEPTH: "1" }, PLACEMENT_CLOSED)).toBe(
      false,
    );
    expect(
      depthGateOpenIn(
        { ...PREVIEW, CELLR_SMART_CELLAR_DEPTH: "1" },
        { ...WRITING, canWrite: false },
      ),
    ).toBe(false);
  });

  it("never opens on production: not with the release declared, not on an unmarked build, not on a custom environment", () => {
    const production = {
      VERCEL: "1",
      VERCEL_ENV: "production",
      VERCEL_TARGET_ENV: "production",
      CELLR_SMART_CELLAR_DEPTH: "1",
      CELLR_SMART_CELLAR: "write",
      CELLR_SMART_CELLAR_PRODUCTION_DATABASE: "db.example.invalid",
      NEXT_PUBLIC_SUPABASE_URL: "https://db.example.invalid",
    };
    expect(depthGateOpenIn(production, WRITING)).toBe(false);
    expect(depthGateOpenIn({ ...production, VERCEL_TARGET_ENV: undefined }, WRITING)).toBe(false);
    expect(
      depthGateOpenIn({ CELLR_SMART_CELLAR_DEPTH: "1", NODE_ENV: "production" }, WRITING),
    ).toBe(false);
    expect(
      depthGateOpenIn(
        { ...PREVIEW, VERCEL_TARGET_ENV: "staging", CELLR_SMART_CELLAR_DEPTH: "1" },
        WRITING,
      ),
    ).toBe(false);
    expect(
      depthGateOpenIn(
        { ...PREVIEW, VERCEL_TARGET_ENV: "production", CELLR_SMART_CELLAR_DEPTH: "1" },
        WRITING,
      ),
    ).toBe(false);
  });
});
