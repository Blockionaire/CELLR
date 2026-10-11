import { describe, expect, it } from "vitest";
import { buildCsp } from "./csp";

const base = { nonce: "abc123", isDev: false, supabaseUrl: "https://ref.supabase.co/some/path" };

describe("buildCsp", () => {
  it("ties scripts to the per-request nonce and never allows inline/eval in production", () => {
    const csp = buildCsp(base);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
  it("allows eval only in development (React debugging)", () => {
    expect(buildCsp({ ...base, isDev: true })).toContain("'unsafe-eval'");
  });
  it("allows exactly one external origin: our Supabase project (origin only, no path)", () => {
    const csp = buildCsp(base);
    expect(csp).toContain("img-src 'self' blob: data: https://ref.supabase.co;");
    expect(csp).toContain("connect-src 'self' https://ref.supabase.co;");
    expect(csp).not.toContain("/some/path");
    expect(csp.match(/https:\/\/[a-z.]+/g)?.every((u) => u === "https://ref.supabase.co")).toBe(
      true,
    );
  });
  it("forbids framing, plugins and foreign form targets", () => {
    const csp = buildCsp(base);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
  it("upgrades insecure requests only outside development", () => {
    expect(buildCsp(base)).toContain("upgrade-insecure-requests");
    expect(buildCsp({ ...base, isDev: true })).not.toContain("upgrade-insecure-requests");
  });
  it("rejects a malformed Supabase URL instead of silently weakening the policy", () => {
    expect(() => buildCsp({ ...base, supabaseUrl: "nope" })).toThrow();
  });
});
