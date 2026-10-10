import { describe, expect, it } from "vitest";
import { parsePublicEnv } from "./public-env";

describe("parsePublicEnv", () => {
  const ok = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_" + "x".repeat(20),
  };
  it("accepts a complete environment", () => {
    expect(parsePublicEnv(ok)).toEqual({
      supabaseUrl: ok.NEXT_PUBLIC_SUPABASE_URL,
      supabasePublishableKey: ok.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
  });
  it("names the missing variables but never echoes values", () => {
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "secret-ish-short",
      }),
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_URL.*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    try {
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "secret-ish-short",
      });
    } catch (e) {
      expect(String(e)).not.toMatch(/not-a-url|secret-ish-short/);
    }
  });
  it("fails when empty", () => {
    expect(() => parsePublicEnv({})).toThrow();
  });
});
