import { describe, expect, it } from "vitest";
import {
  ADMIN_NOT_FOUND_PATH,
  classifyPath,
  isAdminPath,
  refuseAdmin,
  safeNextPath,
} from "./routes";

describe("classifyPath", () => {
  it.each([
    ["/", "protected"],
    ["/cellar", "protected"],
    ["/cellar/abc", "protected"],
    ["/onboarding", "protected"],
    ["/sign-in", "auth-only"],
    ["/sign-in/verify", "auth-only"],
    ["/design", "public"],
    ["/design/colors", "public"],
  ])("%s → %s", (path, kind) => {
    expect(classifyPath(path)).toBe(kind);
  });
  it("does not treat look-alike prefixes as public", () => {
    expect(classifyPath("/designs")).toBe("protected");
    expect(classifyPath("/sign-in-now")).toBe("protected");
    expect(classifyPath("/offline")).toBe("protected");
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

describe("the admin dashboard's early 404", () => {
  const admins = new Set(["0b6f2c1e-6a1d-4f7e-9a3b-2c4d5e6f7a8b"]);
  it("covers /admin and everything under it, nothing else", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/wines/x")).toBe(true);
    expect(isAdminPath("/administration")).toBe(false);
    expect(isAdminPath("/cellar")).toBe(false);
  });
  it("refuses a signed-in person who is not on the allowlist", () => {
    expect(refuseAdmin("/admin/wines", "1c7a3d2f-7b2e-4a8f-8b4c-3d5e6f7a8b9c", admins)).toBe(true);
  });
  it("lets an allowlisted admin through (the pages check again), whatever the case of the id", () => {
    expect(refuseAdmin("/admin", "0B6F2C1E-6A1D-4F7E-9A3B-2C4D5E6F7A8B", admins)).toBe(false);
  });
  it("leaves signed-out visitors to the sign-in redirect, and other pages alone", () => {
    expect(refuseAdmin("/admin", null, admins)).toBe(false);
    expect(refuseAdmin("/cellar", "1c7a3d2f-7b2e-4a8f-8b4c-3d5e6f7a8b9c", admins)).toBe(false);
  });
  it("refuses everyone signed in when no admin is configured", () => {
    expect(refuseAdmin("/admin", "0b6f2c1e-6a1d-4f7e-9a3b-2c4d5e6f7a8b", new Set())).toBe(true);
  });
  it("rewrites to a path no route matches", () => {
    expect(isAdminPath(ADMIN_NOT_FOUND_PATH)).toBe(false);
    expect(ADMIN_NOT_FOUND_PATH.startsWith("/_")).toBe(true);
  });
});
