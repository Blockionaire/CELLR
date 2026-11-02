import { describe, expect, it } from "vitest";
import { activeHref, type AdminNavGroup } from "./admin-nav";

const groups: AdminNavGroup[] = [
  { label: null, items: [{ href: "/admin", label: "Overview" }] },
  {
    label: "Wine management",
    items: [
      { href: "/admin/wines", label: "Wines" },
      { href: "/admin/catalog", label: "Catalogue" },
      { href: "/admin/catalog/corrections", label: "Corrections" },
    ],
  },
];

describe("the admin sidebar's current page", () => {
  it("marks the overview only on the overview", () => {
    expect(activeHref("/admin", groups)).toBe("/admin");
    expect(activeHref("/admin/wines", groups)).toBe("/admin/wines");
  });
  it("keeps a section marked on its detail pages, the most specific one winning", () => {
    expect(activeHref("/admin/wines/0b6f2c1e-6a1d-4f7e-9a3b-2c4d5e6f7a8b", groups)).toBe(
      "/admin/wines",
    );
    expect(activeHref("/admin/catalog/123", groups)).toBe("/admin/catalog");
    expect(activeHref("/admin/catalog/corrections/abc", groups)).toBe("/admin/catalog/corrections");
  });
  it("does not mark a page that merely shares a prefix", () => {
    expect(activeHref("/admin/winesx", groups)).toBeNull();
  });
});
