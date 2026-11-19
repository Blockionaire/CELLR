import { describe, expect, it } from "vitest";
import { PRODUCTION_DATABASE_HOSTS, writeTargetIn } from "./smart-cellar-write-target";
import { smartCellarAccessIn } from "./smart-cellar-gate";

const PROD = "vvelgyhbjfmjvxkzekyz.supabase.co";
const TEST_DB = "abcdefghijklmnopqrst.supabase.co";
const url = (host: string) => ({ NEXT_PUBLIC_SUPABASE_URL: `https://${host}` });
const PREVIEW_WRITE = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_TARGET_ENV: "preview",
  CELLR_SMART_CELLAR: "write",
};

describe("the database a layout may be written to", () => {
  it("knows production by name", () => {
    expect(PRODUCTION_DATABASE_HOSTS).toContain(PROD);
    expect(writeTargetIn(url(PROD))).toEqual({ verified: false, kind: "production", host: PROD });
  });

  it("the local stack is a test database", () => {
    for (const u of ["http://localhost:54321", "http://127.0.0.1:54321", "http://[::1]:54321"])
      expect(writeTargetIn({ NEXT_PUBLIC_SUPABASE_URL: u })).toMatchObject({
        verified: true,
        kind: "local",
      });
  });

  it("a hosted database is a test database only when declared by its exact host", () => {
    expect(writeTargetIn(url(TEST_DB))).toMatchObject({ verified: false, kind: "undeclared" });
    expect(writeTargetIn({ ...url(TEST_DB), CELLR_SMART_CELLAR_WRITE_DATABASE: TEST_DB })).toEqual({
      verified: true,
      kind: "declared",
      host: TEST_DB,
    });
  });

  it("a declaration that is not exactly the host connected to opens nothing", () => {
    for (const declared of [
      `https://${TEST_DB}`,
      `${TEST_DB}/`,
      ` ${TEST_DB}`,
      TEST_DB.toUpperCase(),
      "*.supabase.co",
      "supabase.co",
      `${TEST_DB}.`,
      "abcdefghijklmnopqrsu.supabase.co",
      "",
    ])
      expect(
        writeTargetIn({ ...url(TEST_DB), CELLR_SMART_CELLAR_WRITE_DATABASE: declared }),
        declared,
      ).toMatchObject({ verified: false });
  });

  it("production stays production, however it is written or declared (accident or intent)", () => {
    for (const u of [
      `https://${PROD}`,
      `https://${PROD.toUpperCase()}`,
      `https://${PROD}:443/rest/v1`,
      `http://${PROD}`,
    ])
      for (const declared of [undefined, PROD, "localhost"])
        expect(
          writeTargetIn({
            NEXT_PUBLIC_SUPABASE_URL: u,
            CELLR_SMART_CELLAR_WRITE_DATABASE: declared,
          }),
          `${u} ${declared}`,
        ).toMatchObject({ verified: false, kind: "production" });
  });

  it("anything it cannot read is not verified", () => {
    for (const u of [
      undefined,
      "",
      "not a url",
      "ftp://localhost/x",
      "file:///etc/hosts",
      "https://user:pass@localhost:54321",
      "javascript:alert(1)",
    ])
      expect(writeTargetIn({ NEXT_PUBLIC_SUPABASE_URL: u }), String(u)).toMatchObject({
        verified: false,
      });
  });

  it("look-alikes of loopback are not loopback", () => {
    for (const host of ["localhost.example.com", "127.0.0.1.nip.io", "localhost.", "0.0.0.0"])
      expect(writeTargetIn(url(host)), host).toMatchObject({ verified: false });
  });

  it("at the API's gate: a preview writes to its declared test database, never to production", () => {
    expect(
      smartCellarAccessIn({
        ...PREVIEW_WRITE,
        ...url(TEST_DB),
        CELLR_SMART_CELLAR_WRITE_DATABASE: TEST_DB,
      }),
    ).toEqual({ reads: true, writes: true });
    expect(smartCellarAccessIn({ ...PREVIEW_WRITE, ...url(TEST_DB) })).toEqual({
      reads: true,
      writes: false,
    });
    expect(
      smartCellarAccessIn({
        ...PREVIEW_WRITE,
        ...url(PROD),
        CELLR_SMART_CELLAR_WRITE_DATABASE: PROD,
      }),
    ).toEqual({ reads: true, writes: false });
    // a production deployment never writes, even to a declared test database
    expect(
      smartCellarAccessIn({
        ...PREVIEW_WRITE,
        VERCEL_ENV: "production",
        VERCEL_TARGET_ENV: "production",
        ...url(TEST_DB),
        CELLR_SMART_CELLAR_WRITE_DATABASE: TEST_DB,
      }),
    ).toEqual({ reads: true, writes: false });
  });
});
