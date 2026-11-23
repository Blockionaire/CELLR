import { describe, expect, it } from "vitest";
import { ADMIN_NAV, pageInfo } from "./nav-model";

describe("the admin's structure (Mobile Admin Portal 2.0)", () => {
  it("has four areas for the phone's tab bar, and every page in exactly one", () => {
    expect(ADMIN_NAV.map((g) => g.tab)).toEqual(["overview", "wine", "insights", "system"]);
    const hrefs = ADMIN_NAV.flatMap((g) => g.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toHaveLength(12);
  });

  it("a page of the navigation: its own title and area, no back", () => {
    expect(pageInfo("/admin")).toEqual({
      title: "Overview",
      tab: "overview",
      group: null,
      back: null,
      current: "/admin",
    });
    expect(pageInfo("/admin/catalog/corrections")).toMatchObject({
      title: "Corrections",
      tab: "wine",
      back: null,
      current: "/admin/catalog/corrections",
    });
    expect(pageInfo("/admin/system/health")).toMatchObject({ title: "Health", tab: "system" });
    expect(pageInfo("/admin/ai/")).toMatchObject({ title: "AI & costs", tab: "insights" });
  });

  it("a detail page: named by its list, back to that list", () => {
    expect(pageInfo("/admin/wines/0b6f2c1e-6a1d-4f7e-9a3b-2c4d5e6f7a8b")).toMatchObject({
      title: "Wine",
      tab: "wine",
      back: { href: "/admin/wines", label: "Wine Master Database" },
    });
    expect(pageInfo("/admin/catalog/corrections/abc")).toMatchObject({
      title: "Wine corrections",
      back: { href: "/admin/catalog/corrections" },
    });
    expect(pageInfo("/admin/catalog/abc")).toMatchObject({
      title: "Catalogue candidate",
      back: { href: "/admin/catalog" },
    });
    expect(pageInfo("/admin/users/u1")).toMatchObject({ title: "User", tab: "insights" });
    expect(pageInfo("/admin/bottle-photos/p1")).toMatchObject({ title: "Bottle photo" });
  });

  it("back keeps the list's search, and nothing but a query string can come in that way", () => {
    expect(pageInfo("/admin/wines/w1", "q=Ch%C3%A2teau&scope=catalogue").back?.href).toBe(
      "/admin/wines?q=Ch%C3%A2teau&scope=catalogue",
    );
    // a path, another origin or a script cannot ride along: it is re-encoded as a value
    const evil = pageInfo("/admin/wines/w1", "//evil.example/x?y=<script>").back!.href;
    expect(evil.startsWith("/admin/wines?")).toBe(true);
    expect(evil).not.toContain("<");
    expect(evil).not.toContain("//evil");
  });

  it("outside the known pages: a neutral title, no area", () => {
    expect(pageInfo("/admin/unknown")).toMatchObject({ title: "Admin", tab: null, back: null });
  });
});
