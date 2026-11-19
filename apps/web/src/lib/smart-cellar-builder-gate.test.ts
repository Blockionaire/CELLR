import { describe, expect, it } from "vitest";
import { builderAccessIn } from "./smart-cellar-builder-gate";
import { smartCellarAccessIn } from "./smart-cellar-gate";

const DEV = { NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" };
const PREVIEW = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_TARGET_ENV: "preview",
};
const PROD_DB = { NEXT_PUBLIC_SUPABASE_URL: "https://vvelgyhbjfmjvxkzekyz.supabase.co" };
const TEST_DB = { NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" };
/** The builder's answer, with the API's access worked out from the same environment, as the app does it. */
const access = (env: Record<string, string | undefined>) =>
  builderAccessIn(env, smartCellarAccessIn(env));

describe("the Rack Builder's gate", () => {
  it("is closed when nothing is set, and for anything but exactly 1", () => {
    for (const value of [undefined, "", "0", "true", "yes", " 1", "1 "])
      expect(
        access({ ...DEV, CELLR_SMART_CELLAR: "write", CELLR_SMART_CELLAR_BUILDER: value }),
        String(value),
      ).toEqual({ open: false, canSave: false, saveBlockedBy: null });
  });

  it("needs the Smart Cellar API to read", () => {
    expect(access({ ...DEV, CELLR_SMART_CELLAR_BUILDER: "1" }).open).toBe(false);
    expect(
      access({ ...DEV, CELLR_SMART_CELLAR: "off", CELLR_SMART_CELLAR_BUILDER: "1" }).open,
    ).toBe(false);
  });

  it("is NEVER open on production or where the deployment cannot be told", () => {
    for (const env of [
      { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" },
      { ...PREVIEW, VERCEL_TARGET_ENV: "production" },
      { ...PREVIEW, VERCEL_TARGET_ENV: "staging" },
      { NODE_ENV: "production" },
      { NODE_ENV: "test" },
      { ...DEV, VERCEL_ENV: "production" },
      {},
    ])
      expect(
        access({
          ...env,
          NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
          CELLR_SMART_CELLAR: "write",
          CELLR_SMART_CELLAR_BUILDER: "1",
          DESIGN_GALLERY: "1",
          CELLR_SMART_CELLAR_3D: "1",
        }),
        JSON.stringify(env),
      ).toEqual({ open: false, canSave: false, saveBlockedBy: null });
  });

  it("in next dev on the local stack: open, and it may save", () => {
    expect(
      access({ ...DEV, CELLR_SMART_CELLAR: "write", CELLR_SMART_CELLAR_BUILDER: "1" }),
    ).toEqual({
      open: true,
      canSave: true,
      saveBlockedBy: null,
    });
  });

  it("opening the builder opens no writes: with the API on read it is a preview", () => {
    expect(access({ ...DEV, CELLR_SMART_CELLAR: "read", CELLR_SMART_CELLAR_BUILDER: "1" })).toEqual(
      {
        open: true,
        canSave: false,
        saveBlockedBy: "setting",
      },
    );
  });

  it("a preview that shares the production database: open, preview only, whatever is set", () => {
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
          CELLR_SMART_CELLAR_BUILDER: "1",
        }),
      ).toEqual({ open: true, canSave: false, saveBlockedBy: "database" });
  });

  it("a preview with a database nobody declared: preview only; declared by its host: it may save", () => {
    const base = {
      ...PREVIEW,
      ...TEST_DB,
      CELLR_SMART_CELLAR: "write",
      CELLR_SMART_CELLAR_BUILDER: "1",
    };
    expect(access(base)).toEqual({ open: true, canSave: false, saveBlockedBy: "database" });
    expect(
      access({ ...base, CELLR_SMART_CELLAR_WRITE_DATABASE: "abcdefghijklmnopqrst.supabase.co" }),
    ).toEqual({ open: true, canSave: true, saveBlockedBy: null });
  });
});
