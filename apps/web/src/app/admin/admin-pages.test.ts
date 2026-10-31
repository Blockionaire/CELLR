import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Every admin page checks the admin session itself and shows "not found" before reading anything; and there is no
 * admin data endpoint at all (no API route or Server Action reaches the admin service).
 */
vi.mock("server-only", () => ({}));
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound }));
const reads = {
  adminOverview: vi.fn(),
  adminUsers: vi.fn(),
  adminUser: vi.fn(),
  adminProduct: vi.fn(),
  adminAi: vi.fn(),
  adminFeedback: vi.fn(),
  adminCatalog: vi.fn(),
  adminCandidate: vi.fn(),
  adminBottlePhotos: vi.fn(),
  adminBottlePhoto: vi.fn(),
  adminWineVisuals: vi.fn(),
  adminWineVisual: vi.fn(),
  adminUploadBottleArt: vi.fn(),
  adminCorrections: vi.fn(),
  adminCorrection: vi.fn(),
};
const library = { photoFile: vi.fn(), artFile: vi.fn() };
vi.mock("@/server/admin/service", () => ({
  getAdminSession: async () => null,
  ...reads,
  bottleLibrary: library,
}));

const params = { params: Promise.resolve({ id: "0b6f2c1e-6a1d-4f7e-9a3b-2c4d5e6f7a8b" }) };
const search = { searchParams: Promise.resolve({ page: "2", days: "7" }) };

describe("admin pages without an admin session", () => {
  it.each([
    ["layout", () => import("./layout"), { children: null }],
    ["overview", () => import("./page"), {}],
    ["users", () => import("./users/page"), search],
    ["user", () => import("./users/[id]/page"), params],
    ["product", () => import("./product/page"), search],
    ["ai", () => import("./ai/page"), search],
    ["feedback", () => import("./feedback/page"), search],
    ["catalog", () => import("./catalog/page"), search],
    ["candidate", () => import("./catalog/[id]/page"), { ...params, ...search }],
    ["bottle photos", () => import("./bottle-photos/page"), search],
    ["bottle photo", () => import("./bottle-photos/[id]/page"), { ...params, ...search }],
    ["wine visuals", () => import("./wines/page"), search],
    ["wine visual", () => import("./wines/[id]/page"), { ...params, ...search }],
    ["corrections", () => import("./catalog/corrections/page"), search],
    [
      "correction",
      () => import("./catalog/corrections/[wineId]/page"),
      { params: Promise.resolve({ wineId: "0b6f2c1e-6a1d-4f7e-9a3b-2c4d5e6f7a8b" }), ...search },
    ],
  ] as const)("%s: not found, nothing read", async (_name, load, props) => {
    const Page = (await load()).default as (p: unknown) => Promise<unknown>;
    await expect(Page(props)).rejects.toThrow("NEXT_NOT_FOUND");
    for (const read of Object.values(reads)) expect(read).not.toHaveBeenCalled();
  });
});

const SRC = path.resolve(import.meta.dirname, "../..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });

describe("the admin boundary", () => {
  it("every admin page checks the session itself", () => {
    const pages = files(path.join(SRC, "app/admin")).filter((f) => /(page|layout)\.tsx$/.test(f));
    expect(pages.length).toBe(15);
    for (const p of pages)
      expect(readFileSync(p, "utf8")).toMatch(
        /if \(!(session|\(await getAdminSession\(\)\))\) notFound\(\)/,
      );
  });
  it("no API route, Server Action or client code reaches admin data", () => {
    for (const f of files(SRC)) {
      if (
        f.includes(`${path.sep}app${path.sep}admin${path.sep}`) ||
        f.includes(`${path.sep}server${path.sep}`)
      )
        continue;
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/@\/server\/admin|privileged\/(admin|catalog-admin)/);
    }
    // The admin pages are server-rendered only. The one exception is the catalogue review's Server Actions (they
    // are reachable over HTTP, so each checks the admin session again before doing anything; see below).
    const ACTIONS = ["catalog", "bottle-photos", "wines", "catalog/corrections"].map((d) =>
      path.join(SRC, `app/admin/${d}/actions.ts`),
    );
    for (const f of files(path.join(SRC, "app/admin")))
      if (!ACTIONS.includes(f) && !f.endsWith(".test.ts"))
        expect(readFileSync(f, "utf8"), f).not.toMatch(/["']use (server|client)["']/);
  });

  it.each([
    ["catalog", 6],
    ["bottle-photos", 1],
    ["wines", 3],
    ["catalog/corrections", 1],
  ] as const)(
    "every %s action checks the admin session again before anything else",
    (dir, count) => {
      const text = readFileSync(path.join(SRC, `app/admin/${dir}/actions.ts`), "utf8");
      expect(text).toMatch(/^"use server";/);
      // admin(): the verified admin session, or "not found"
      expect(text).toMatch(
        /async function admin\(\) \{\s+const session = await getAdminSession\(\);\s+if \(!session\) notFound\(\);/,
      );
      const actions = [...text.matchAll(/export async function (\w+)\([^)]*\) \{\n(.*)\n/g)];
      expect(actions.length).toBe(count);
      for (const [, name, first] of actions)
        expect(first!.trim(), name).toBe("const session = await admin();");
    },
  );

  it("every admin route (photos and pictures) checks the admin session and is not found without it", () => {
    const routes = files(path.join(SRC, "app/admin")).filter((f) => f.endsWith("route.ts"));
    expect(routes.length).toBe(3);
    for (const r of routes)
      expect(readFileSync(r, "utf8"), r).toMatch(
        /const session = await getAdminSession\(\);[\s\S]*?if \(!session \|\| [^)]*\) return new Response\(null, \{ status: 404 \}\);/,
      );
  });
});
