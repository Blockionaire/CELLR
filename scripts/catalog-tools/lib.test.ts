import { describe, expect, it } from "vitest";
import { assertSafeTarget, parseArgs, percentile, shuffled } from "./lib";

describe("catalog tools", () => {
  it("refuse any database but a local one unless told it is staging", () => {
    expect(() => assertSafeTarget("postgresql://u@127.0.0.1:5432/db", {})).not.toThrow();
    expect(() => assertSafeTarget("postgresql://u@localhost/db", {})).not.toThrow();
    expect(() =>
      assertSafeTarget("postgresql://u@db.abcdefgh.supabase.co:5432/postgres", {}),
    ).toThrow(/local databases only/);
    expect(() =>
      assertSafeTarget("postgresql://u@staging.example.org/db", { "allow-remote-staging": true }),
    ).not.toThrow();
  });
  it("parse flags and values", () => {
    expect(parseArgs(["--db", "x", "--apply", "--limit", "5"])).toEqual({
      db: "x",
      apply: true,
      limit: "5",
    });
  });
  it("percentiles are nearest-rank", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile([7], 99)).toBe(7);
  });
  it("shuffle is deterministic per seed and keeps every item", () => {
    expect(shuffled([1, 2, 3, 4, 5], 1)).toEqual(shuffled([1, 2, 3, 4, 5], 1));
    expect([...shuffled([1, 2, 3, 4, 5], 2)].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
