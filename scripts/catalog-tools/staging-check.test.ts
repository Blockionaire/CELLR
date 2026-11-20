import { describe, expect, it } from "vitest";
import { compareVersions, repositoryVersions } from "./staging-check";

describe("staging check: migrations", () => {
  it("reads the repository's migration versions in order", () => {
    const v = repositoryVersions(new URL("../../supabase/migrations/", import.meta.url));
    expect(v.length).toBeGreaterThanOrEqual(46);
    expect(v).toEqual([...v].sort());
    expect(v.every((x) => /^\d{14}$/.test(x))).toBe(true);
    expect(v).toContain("20261119000042");
  });
  it("reports what is missing and what is extra", () => {
    expect(compareVersions(["1", "2", "3"], ["1", "3", "9"])).toEqual({
      missing: ["2"],
      extra: ["9"],
    });
    expect(compareVersions(["1"], ["1"])).toEqual({ missing: [], extra: [] });
  });
});
