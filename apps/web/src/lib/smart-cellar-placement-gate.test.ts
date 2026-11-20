import { describe, expect, it } from "vitest";
import { smartCellarAccessIn } from "./smart-cellar-gate";
import { placementAccessIn } from "./smart-cellar-placement-gate";

const DEV = { NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" };
const PREVIEW = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_TARGET_ENV: "preview",
};
const PROD_DB = { NEXT_PUBLIC_SUPABASE_URL: "https://vvelgyhbjfmjvxkzekyz.supabase.co" };
const access = (env: Record<string, string | undefined>) =>
  placementAccessIn(env, smartCellarAccessIn(env));
const CLOSED = { open: false, canWrite: false, depth: false };

describe("the placement gate", () => {
  it("is closed when nothing is set, and for anything but exactly 1", () => {
    for (const value of [undefined, "", "0", "true", " 1"])
      expect(
        access({ ...DEV, CELLR_SMART_CELLAR: "write", CELLR_SMART_CELLAR_PLACEMENT: value }),
      ).toEqual(CLOSED);
  });

  it("is NEVER open on production or an unknown deployment, whatever else is set", () => {
    for (const env of [
      { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" },
      { ...PREVIEW, VERCEL_TARGET_ENV: "production" },
      { ...PREVIEW, VERCEL_TARGET_ENV: "staging" },
      { NODE_ENV: "production" },
      { NODE_ENV: "test" },
      {},
    ])
      expect(
        access({
          ...env,
          NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
          CELLR_SMART_CELLAR: "write",
          CELLR_SMART_CELLAR_PLACEMENT: "1",
          CELLR_SMART_CELLAR_BUILDER: "1",
          CELLR_SMART_CELLAR_3D: "1",
        }),
        JSON.stringify(env),
      ).toEqual(CLOSED);
  });

  it("needs the API to read; opens no writes by itself", () => {
    expect(access({ ...DEV, CELLR_SMART_CELLAR_PLACEMENT: "1" })).toEqual(CLOSED);
    expect(
      access({ ...DEV, CELLR_SMART_CELLAR: "read", CELLR_SMART_CELLAR_PLACEMENT: "1" }),
    ).toEqual({
      open: true,
      canWrite: false,
      depth: false,
    });
  });

  it("writes on the local stack in development; never depth in this version", () => {
    expect(
      access({ ...DEV, CELLR_SMART_CELLAR: "write", CELLR_SMART_CELLAR_PLACEMENT: "1" }),
    ).toEqual({
      open: true,
      canWrite: true,
      depth: false,
    });
  });

  it("a preview on the production database: shown, never writing, whatever is declared", () => {
    for (const extra of [
      {},
      { CELLR_SMART_CELLAR_WRITE_DATABASE: "vvelgyhbjfmjvxkzekyz.supabase.co" },
    ])
      expect(
        access({
          ...PREVIEW,
          ...PROD_DB,
          ...extra,
          CELLR_SMART_CELLAR: "write",
          CELLR_SMART_CELLAR_PLACEMENT: "1",
        }),
      ).toEqual({ open: true, canWrite: false, depth: false });
  });
});
