import { describe, expect, it } from "vitest";
import { sharedRacksAccessIn } from "./shared-racks-gate";

const LOCAL_DB = { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" };
const DEV = { NODE_ENV: "development", ...LOCAL_DB };
const PREVIEW = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_TARGET_ENV: "preview",
};
const PRODUCTION = { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" };
const PROD_DB = { NEXT_PUBLIC_SUPABASE_URL: "https://vvelgyhbjfmjvxkzekyz.supabase.co" };
const CLOSED = { open: false, writes: false };
/** Every other switch there is, set as far open as it goes. */
const EVERYTHING_ELSE = {
  CELLR_SMART_CELLAR: "write",
  CELLR_SMART_CELLAR_3D: "1",
  CELLR_SMART_CELLAR_BUILDER: "1",
  CELLR_SMART_CELLAR_PLACEMENT: "1",
  CELLR_SMART_CELLAR_ADVICE: "1",
  CELLR_FEATURES: "all",
  DESIGN_GALLERY: "1",
};

describe("the shared racks gate", () => {
  it("is closed when nothing is set, and for anything but exactly 1", () => {
    for (const value of [undefined, "", "0", "true", "on", "write", " 1", "1 "])
      expect(sharedRacksAccessIn({ ...DEV, CELLR_SHARED_RACKS: value }), String(value)).toEqual(
        CLOSED,
      );
  });

  it("opens in next dev and on a Vercel preview, writing to the local stack", () => {
    expect(sharedRacksAccessIn({ ...DEV, CELLR_SHARED_RACKS: "1" })).toEqual({
      open: true,
      writes: true,
    });
    expect(sharedRacksAccessIn({ ...PREVIEW, ...LOCAL_DB, CELLR_SHARED_RACKS: "1" })).toEqual({
      open: true,
      writes: true,
    });
  });

  it("is NEVER open on production or a deployment that cannot be told, whatever else is set", () => {
    for (const env of [
      PRODUCTION,
      { ...PRODUCTION, VERCEL_TARGET_ENV: "production" },
      { ...PREVIEW, VERCEL_TARGET_ENV: "production" },
      { ...PREVIEW, VERCEL_TARGET_ENV: "staging" },
      { NODE_ENV: "production" },
      { NODE_ENV: "test" },
      {},
    ])
      for (const db of [LOCAL_DB, PROD_DB, {}])
        expect(
          sharedRacksAccessIn({ ...env, ...db, ...EVERYTHING_ELSE, CELLR_SHARED_RACKS: "1" }),
          JSON.stringify({ ...env, ...db }),
        ).toEqual(CLOSED);
  });

  it("the authorized Smart Cellar production release does NOT open shared racks", () => {
    expect(
      sharedRacksAccessIn({
        ...PRODUCTION,
        ...PROD_DB,
        ...EVERYTHING_ELSE,
        CELLR_SMART_CELLAR_PRODUCTION_DATABASE: "vvelgyhbjfmjvxkzekyz.supabase.co",
        CELLR_SHARED_RACKS: "1",
      }),
    ).toEqual(CLOSED);
  });

  it("never writes to the production database, not from a preview and not from next dev", () => {
    for (const env of [PREVIEW, { NODE_ENV: "development" }]) {
      expect(sharedRacksAccessIn({ ...env, ...PROD_DB, CELLR_SHARED_RACKS: "1" })).toEqual({
        open: true,
        writes: false,
      });
      // naming production as "the test database" opens nothing
      expect(
        sharedRacksAccessIn({
          ...env,
          ...PROD_DB,
          CELLR_SHARED_RACKS: "1",
          CELLR_SMART_CELLAR_WRITE_DATABASE: "vvelgyhbjfmjvxkzekyz.supabase.co",
        }).writes,
      ).toBe(false);
    }
  });

  it("writes to a hosted database only when this deployment declares exactly that host as its test database", () => {
    const hosted = { NEXT_PUBLIC_SUPABASE_URL: "https://isolated-test.supabase.co" };
    expect(sharedRacksAccessIn({ ...PREVIEW, ...hosted, CELLR_SHARED_RACKS: "1" }).writes).toBe(
      false,
    );
    expect(
      sharedRacksAccessIn({
        ...PREVIEW,
        ...hosted,
        CELLR_SHARED_RACKS: "1",
        CELLR_SMART_CELLAR_WRITE_DATABASE: "another.supabase.co",
      }).writes,
    ).toBe(false);
    expect(
      sharedRacksAccessIn({
        ...PREVIEW,
        ...hosted,
        CELLR_SHARED_RACKS: "1",
        CELLR_SMART_CELLAR_WRITE_DATABASE: "isolated-test.supabase.co",
      }),
    ).toEqual({ open: true, writes: true });
  });

  it("is independent of the Smart Cellar gates: none of them opens it, and it needs none of them", () => {
    expect(sharedRacksAccessIn({ ...DEV, ...EVERYTHING_ELSE })).toEqual(CLOSED);
    expect(
      sharedRacksAccessIn({ ...DEV, CELLR_SMART_CELLAR: "off", CELLR_SHARED_RACKS: "1" }).open,
    ).toBe(true);
  });
});
