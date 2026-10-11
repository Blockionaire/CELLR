import { describe, expect, it } from "vitest";
import { isActive, NAV_ITEMS } from "./nav-items";

describe("isActive", () => {
  it("Home is only active on the root", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/cellar", "/")).toBe(false);
  });
  it("a tab stays active on its sub-pages, but not on look-alikes", () => {
    expect(isActive("/cellar", "/cellar")).toBe(true);
    expect(isActive("/cellar/abc", "/cellar")).toBe(true);
    expect(isActive("/cellars", "/cellar")).toBe(false);
  });
});

describe("NAV_ITEMS", () => {
  it("has exactly one primary action and it is Scan, in the middle", () => {
    expect(NAV_ITEMS.filter((i) => i.primary).map((i) => i.key)).toEqual(["scan"]);
    expect(NAV_ITEMS[2]?.key).toBe("scan");
    expect(NAV_ITEMS).toHaveLength(5);
  });
});
