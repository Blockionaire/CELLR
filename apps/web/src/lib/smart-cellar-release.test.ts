import { describe, expect, it } from "vitest";
import { DEPTH_PLACEMENT_ENABLED } from "@cellr/domain";
import { adviceOpenIn } from "./smart-cellar-advice-gate";
import { builderAccessIn } from "./smart-cellar-builder-gate";
import { smartCellarAccessIn } from "./smart-cellar-gate";
import { placementAccessIn } from "./smart-cellar-placement-gate";
import { productionReleaseIn, vercelProductionIn } from "./smart-cellar-release";
import { smartCellarMayShowIn, smartCellarRendererOpenIn } from "./smart-cellar-renderer-gate";

const PROD_HOST = "vvelgyhbjfmjvxkzekyz.supabase.co";
const VERCEL_PRODUCTION = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_TARGET_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_HOST}`,
};
const FEATURES = {
  CELLR_SMART_CELLAR: "write",
  CELLR_SMART_CELLAR_3D: "1",
  CELLR_SMART_CELLAR_BUILDER: "1",
  CELLR_SMART_CELLAR_PLACEMENT: "1",
  CELLR_SMART_CELLAR_ADVICE: "1",
};
const RELEASED = {
  ...VERCEL_PRODUCTION,
  ...FEATURES,
  CELLR_SMART_CELLAR_PRODUCTION_DATABASE: PROD_HOST,
};

/** Everything the app derives from an environment, the way server/env.ts derives it. */
function everything(env: Record<string, string | undefined>) {
  const api = smartCellarAccessIn(env);
  const placement = placementAccessIn(env, api);
  return {
    reads: api.reads,
    writes: api.writes,
    renderer: smartCellarRendererOpenIn(env, api),
    builder: builderAccessIn(env, api).open,
    builderSaves: builderAccessIn(env, api).canSave,
    placement: placement.open,
    placementWrites: placement.canWrite,
    depth: placement.depth,
    advice: adviceOpenIn(env, placement),
  };
}

const ALL_OPEN = {
  reads: true,
  writes: true,
  renderer: true,
  builder: true,
  builderSaves: true,
  placement: true,
  placementWrites: true,
  depth: false,
  advice: true,
};

describe("the production release of Smart Cellar 3D", () => {
  it("opens everything, writes included, on the released production deployment; never depth", () => {
    expect(productionReleaseIn(RELEASED)).toBe(true);
    expect(everything(RELEASED)).toEqual(ALL_OPEN);
    expect(DEPTH_PLACEMENT_ENABLED).toBe(false);
  });

  it("without the explicit declaration, production stays exactly as before: nothing new shown, nothing written", () => {
    const env = { ...VERCEL_PRODUCTION, ...FEATURES };
    expect(productionReleaseIn(env)).toBe(false);
    expect(everything(env)).toEqual({
      reads: true, // CELLR_SMART_CELLAR reads anywhere, as since sprint 1C
      writes: false,
      renderer: false,
      builder: false,
      builderSaves: false,
      placement: false,
      placementWrites: false,
      depth: false,
      advice: false,
    });
  });

  it("the declaration must name exactly the database this server connects to, and that one must be production", () => {
    for (const declared of [
      "VVELGYHBJFMJVXKZEKYZ.supabase.co",
      `https://${PROD_HOST}`,
      `${PROD_HOST}/`,
      `*.supabase.co`,
      ` ${PROD_HOST}`,
      "other-project.supabase.co",
      "",
    ])
      expect(
        productionReleaseIn({ ...RELEASED, CELLR_SMART_CELLAR_PRODUCTION_DATABASE: declared }),
        declared,
      ).toBe(false);
    // connected elsewhere than declared
    expect(
      productionReleaseIn({ ...RELEASED, NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co" }),
    ).toBe(false);
    // a host that is not on the production list in code, even declared and connected consistently
    expect(
      productionReleaseIn({
        ...RELEASED,
        NEXT_PUBLIC_SUPABASE_URL: "https://staging.supabase.co",
        CELLR_SMART_CELLAR_PRODUCTION_DATABASE: "staging.supabase.co",
      }),
    ).toBe(false);
  });

  it("a preview never gains production write authority, even with the production declaration", () => {
    const preview = {
      ...RELEASED,
      VERCEL_ENV: "preview",
      VERCEL_TARGET_ENV: "preview",
    };
    expect(productionReleaseIn(preview)).toBe(false);
    const e = everything(preview);
    // a preview may show the features (as before) but, on the production database, never write
    expect(e.writes).toBe(false);
    expect(e.builderSaves).toBe(false);
    expect(e.placementWrites).toBe(false);
  });

  it("unknown or custom environments fail closed", () => {
    for (const env of [
      { ...RELEASED, VERCEL: undefined }, // a production build without Vercel's marker
      { ...RELEASED, VERCEL_ENV: undefined, VERCEL_TARGET_ENV: undefined },
      { ...RELEASED, VERCEL_TARGET_ENV: "staging" }, // a custom environment
      { ...RELEASED, VERCEL_ENV: "development" },
      { ...RELEASED, NEXT_PUBLIC_SUPABASE_URL: undefined },
      { ...RELEASED, NEXT_PUBLIC_SUPABASE_URL: "not a url" },
    ]) {
      expect(productionReleaseIn(env)).toBe(false);
      const e = everything(env);
      expect(e.writes).toBe(false);
      expect(e.renderer || e.builder || e.placement || e.advice).toBe(false);
    }
    expect(vercelProductionIn({ VERCEL: "1", VERCEL_ENV: "production" })).toBe(true);
  });

  it("the kill switch: CELLR_SMART_CELLAR off (or unset) closes everything at once, writes and every view", () => {
    for (const mode of ["off", "", undefined, "OFF-please", "true"]) {
      const e = everything({ ...RELEASED, CELLR_SMART_CELLAR: mode });
      expect(e, String(mode)).toEqual({
        reads: false,
        writes: false,
        renderer: false,
        builder: false,
        builderSaves: false,
        placement: false,
        placementWrites: false,
        depth: false,
        advice: false,
      });
    }
  });

  it("read: the views stay, every write closes (a softer switch)", () => {
    const e = everything({ ...RELEASED, CELLR_SMART_CELLAR: "read" });
    expect(e).toEqual({
      ...ALL_OPEN,
      writes: false,
      builderSaves: false,
      placementWrites: false,
    });
  });

  it("each feature still needs its own setting; advice never without placement", () => {
    expect(everything({ ...RELEASED, CELLR_SMART_CELLAR_3D: undefined }).renderer).toBe(false);
    expect(everything({ ...RELEASED, CELLR_SMART_CELLAR_BUILDER: "0" }).builder).toBe(false);
    const noPlacement = everything({ ...RELEASED, CELLR_SMART_CELLAR_PLACEMENT: undefined });
    expect(noPlacement.placement).toBe(false);
    expect(noPlacement.advice).toBe(false);
    expect(smartCellarMayShowIn(RELEASED)).toBe(true);
  });
});
