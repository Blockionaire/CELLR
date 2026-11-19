import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { edgeId, validateRegistry, type RepositoryInventory } from "@cellr/domain";
import { buildInventory } from "../../../scripts/architecture/inventory-builder";
import { ARCHITECTURE_REGISTRY as REG } from "./registry";
import { architectureView } from "./service";

/**
 * The architecture register is checked against the repository (System Intelligence ADR-001). A red test here means
 * the map would show something the code does not prove, or the code has something the map does not show. Fix the
 * register (REGISTRY-GUIDE.md), never the test.
 */
const ROOT = path.resolve(import.meta.dirname, "../../../../..");
const committed = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "inventory.generated.json"), "utf8"),
) as RepositoryInventory;
const fileCache = new Map<string, string>();
const text = (rel: string) => {
  if (!fileCache.has(rel)) fileCache.set(rel, readFileSync(path.join(ROOT, rel), "utf8"));
  return fileCache.get(rel)!;
};

describe("the repository inventory", () => {
  it("is up to date (run `pnpm architecture:inventory` after changing tables, routes, buckets, jobs or modules)", () => {
    expect(buildInventory(ROOT)).toEqual(committed);
  });
  it("found what the repository certainly has", () => {
    expect(committed.tables.length).toBeGreaterThanOrEqual(58);
    expect(committed.apiRoutes.length).toBeGreaterThanOrEqual(80);
    expect(committed.buckets.length).toBeGreaterThanOrEqual(7);
    expect(committed.cronJobs.map((j) => j.name)).toContain("sommelier-conversations-purge");
    expect(committed.features).toContain("scan_resolver");
    for (const r of committed.apiRoutes) expect(r.methods.length, r.path).toBeGreaterThan(0);
  });
});

describe("the architecture register against the repository", () => {
  it("validates without errors or warnings (ids, endpoints, flows, ownership of every table, bucket, job, route)", () => {
    expect(validateRegistry(REG, committed)).toEqual([]);
  });

  it("every source path exists (a directory ends in /)", () => {
    const missing = REG.components.flatMap((c) =>
      c.sources.filter((s) => {
        const p = path.join(ROOT, s);
        return !existsSync(p) || statSync(p).isDirectory() !== s.endsWith("/");
      }),
    );
    expect(missing).toEqual([]);
  });

  it("every confirmed edge's evidence is found in its file", () => {
    const broken: string[] = [];
    for (const e of REG.edges)
      for (const ev of e.evidence) {
        const p = path.join(ROOT, ev.path);
        if (!existsSync(p) || statSync(p).isDirectory())
          broken.push(`${edgeId(e)}: no file ${ev.path}`);
        else if (!text(ev.path).includes(ev.contains))
          broken.push(`${edgeId(e)}: "${ev.contains}" not in ${ev.path}`);
      }
    expect(broken).toEqual([]);
  });

  it("every server module belongs to a component", () => {
    const sources = REG.components.flatMap((c) => c.sources);
    const covered = (m: string) =>
      sources.some(
        (s) =>
          s === m || (m.endsWith("/") && s.startsWith(m)) || (s.endsWith("/") && m.startsWith(s)),
      );
    expect(committed.serverModules.filter((m) => !covered(m))).toEqual([]);
  });

  it("every env gate is a setting server/env.ts reads", () => {
    const env = text("apps/web/src/server/env.ts");
    const gates = REG.components.flatMap((c) => (c.gates ?? []).filter((g) => g.kind === "env"));
    expect(gates.length).toBeGreaterThan(0);
    for (const g of gates) expect(env, g.name).toContain(g.name);
  });

  it("every Vercel cron calls a route a component owns", () => {
    const owned = new Set(REG.components.flatMap((c) => c.routes ?? []));
    for (const c of committed.vercelCrons) expect(owned.has(c.path), c.path).toBe(true);
  });

  it("holds nothing that looks like a secret, an e-mail address or a user id", () => {
    const all = JSON.stringify(REG);
    expect(all).not.toMatch(
      /sk-[A-Za-z0-9]{8,}|sb_(secret|publishable)_|eyJ[A-Za-z0-9_-]{10,}|-----BEGIN/,
    );
    expect(all).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
    expect(all).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("the page's view is the register, the committed inventory and no issues", () => {
    const view = architectureView();
    expect(view.registry).toBe(REG);
    expect(view.inventory).toEqual(committed);
    expect(view.issues).toEqual([]);
  });
});

describe("the register stays on the server", () => {
  const SRC = path.resolve(import.meta.dirname, "../..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });
  it("only the admin service reaches it, outside its own folder and tests", () => {
    const importers = files(SRC)
      .filter(
        (f) =>
          !f.includes(`${path.sep}server${path.sep}system${path.sep}`) && !/\.test\.tsx?$/.test(f),
      )
      .filter((f) => /(from|import\()\s*["'][^"']*server\/system\//.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(importers).toEqual([path.join("server", "admin", "service.ts")]);
  });
  it("its modules are server-only", () => {
    for (const f of ["registry.ts", "service.ts"])
      expect(readFileSync(path.join(import.meta.dirname, f), "utf8")).toMatch(
        /^import "server-only";/,
      );
  });
});
