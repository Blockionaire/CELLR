import { describe, expect, it } from "vitest";
import { classifyPath, safeNextPath } from "./routes";

describe("classifyPath", () => {
  it.each([
    ["/", "protected"],
    ["/cellar", "protected"],
    ["/cellar/abc", "protected"],
    ["/onboarding", "protected"],
    ["/sign-in", "auth-only"],
    ["/sign-in/verify", "auth-only"],
    ["/offline", "public"],
    ["/design", "public"],
    ["/design/colors", "public"],
  ])("%s → %s", (path, kind) => {
    expect(classifyPath(path)).toBe(kind);
  });
  it("does not treat look-alike prefixes as public", () => {
    expect(classifyPath("/designs")).toBe("protected");
    expect(classifyPath("/sign-in-now")).toBe("protected");
    expect(classifyPath("/offline-secrets")).toBe("protected");
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths (with query)", () => {
    expect(safeNextPath("/cellar?filter=red")).toBe("/cellar?filter=red");
  });
  it.each([
    null,
    undefined,
    "",
    "cellar",
    "//evil.test",
    "https://evil.test",
    "/\\evil.test",
    "javascript:alert(1)",
  ])("falls back to / for %j", (v) => {
    expect(safeNextPath(v)).toBe("/");
  });
  it("never sends a signed-in user back to the sign-in page", () => {
    expect(safeNextPath("/sign-in?next=/x")).toBe("/");
  });
});
