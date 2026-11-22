import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { edgeId, validateRegistry, type RepositoryInventory } from "@cellr/domain";
import {
  buildInventory,
  resolveImport,
  runtimeImports,
} from "../../../scripts/architecture/inventory-builder";
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

  it("every route group and folder of the app belongs to a component", () => {
    const sources = REG.components.flatMap((c) => c.sources);
    const app = "apps/web/src/app";
    const dirs = readdirSync(path.join(ROOT, app), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `${app}/${d.name}/`);
    const covered = (d: string) => sources.some((s) => s.startsWith(d) || d.startsWith(s));
    expect(dirs.filter((d) => !covered(d))).toEqual([]);
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

// ---- The code's own links, each backed by an edge (architecture stays current, REGISTRY-GUIDE.md) -------------------

const walkCode = (rel: string): string[] =>
  readdirSync(path.join(ROOT, rel), { withFileTypes: true }).flatMap((e) => {
    const child = `${rel}${e.name}`;
    if (e.isDirectory()) return walkCode(`${child}/`);
    return e.isFile() && /\.(ts|tsx)$/.test(e.name) && !/\.(test|spec|d)\.tsx?$/.test(e.name)
      ? [child]
      : [];
  });
const APP_FILES = walkCode("apps/web/src/");
const DOMAIN_FILES = walkCode("packages/domain/src/");

/** The component a file belongs to: the most specific source that covers it. */
const ownerOf = (file: string): string | null => {
  let best: { id: string; len: number } | null = null;
  for (const c of REG.components)
    for (const src of c.sources)
      if (
        (src.endsWith("/") ? file.startsWith(src) : file === src) &&
        (!best || src.length > best.len)
      )
        best = { id: c.id, len: src.length };
  return best?.id ?? null;
};
const confirmed = (from: string, to: string, kinds?: readonly string[]) =>
  REG.edges.some(
    (e) =>
      e.from === from && e.to === to && e.kind !== "planned" && (!kinds || kinds.includes(e.kind)),
  );
const FOUNDATION = new Set(REG.components.filter((c) => c.foundation).map((c) => c.id));

describe("the code's links are in the register", () => {
  it("every source file of the app and the domain package belongs to a component", () => {
    expect([...APP_FILES, ...DOMAIN_FILES].filter((f) => ownerOf(f) === null)).toEqual([]);
  });

  it("every GitHub Actions workflow belongs to a component", () => {
    expect(committed.workflows.map((w) => w.file).filter((f) => ownerOf(f) === null)).toEqual([]);
  });

  it("every import from one component into another is an edge (foundation excepted)", () => {
    const files = new Set(APP_FILES);
    const missing = new Map<string, string>();
    for (const f of APP_FILES) {
      const from = ownerOf(f)!;
      for (const spec of runtimeImports(text(f))) {
        const target = resolveImport(f, spec, files);
        const to = target ? ownerOf(target) : null;
        if (!to || to === from || FOUNDATION.has(to) || confirmed(from, to)) continue;
        missing.set(`${from} -> ${to}`, `${f} imports ${spec}`);
      }
    }
    expect(Object.fromEntries(missing)).toEqual({});
  });

  it("every table a component reads or writes is a data edge to the table's owner", () => {
    const tableOwner = new Map(
      REG.components.flatMap((c) => (c.tables ?? []).map((t) => [t, c.id] as const)),
    );
    const missing = new Map<string, string>();
    for (const f of APP_FILES) {
      if (f.startsWith("apps/web/src/server/system/")) continue; // the register's evidence, not access
      const from = ownerOf(f)!;
      for (const m of text(f).matchAll(/\.from\(\s*["']([a-z_0-9]+)["']\s*\)/g)) {
        const to = tableOwner.get(m[1]!);
        if (!to || to === from || confirmed(from, to, ["data-read", "data-write"])) continue;
        missing.set(`${from} -> ${to}`, `${f} uses table ${m[1]}`);
      }
    }
    expect(Object.fromEntries(missing)).toEqual({});
  });

  it("a confirmed edge is proven by code, never by prose: no Markdown evidence, no one-word texts", () => {
    const weak = REG.edges
      .filter((e) => e.kind !== "planned")
      .flatMap((e) =>
        e.evidence
          .filter((ev) => /\.mdx?$/.test(ev.path) || ev.contains.trim().length < 6)
          .map((ev) => `${edgeId(e)}: ${ev.path} "${ev.contains}"`),
      );
    expect(weak).toEqual([]);
  });

  it("a foundation component is plumbing only: it has no routes, tables or jobs of its own", () => {
    for (const c of REG.components.filter((x) => x.foundation))
      expect([c.routes, c.tables, c.cronJobs].flat().filter(Boolean), c.id).toEqual([]);
  });
});

describe("structure and live health stay apart", () => {
  it("the register, its service and the inventory builder read no live data", () => {
    const structural = [
      ...walkCode("apps/web/src/server/system/"),
      ...walkCode("apps/web/scripts/architecture/").filter((f) => f.endsWith(".ts")),
    ];
    const live = /^(@\/server\/(health|privileged|db)\/|@supabase\/|@\/server\/services$)/;
    // real import statements only: the register's evidence texts quote such imports, they do not make them
    const reached = structural.flatMap((f) =>
      runtimeImports(text(f))
        .filter((spec) => live.test(spec))
        .map((spec) => `${f} imports ${spec}`),
    );
    expect(reached).toEqual([]);
  });
});

describe("the architecture scripts run on the Node the repository asks for", () => {
  const scripts = path.join(ROOT, "apps/web/scripts/architecture");
  const run = (code: string) =>
    execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: scripts,
      encoding: "utf8",
    }).trim();

  it("take their minimum from package.json engines, which has the form they parse", () => {
    const engines = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).engines.node;
    expect(engines).toMatch(/^>=\d+\.\d+$/);
    const out = run(
      `import { minimumOf, satisfies } from "./node-version.mjs";` +
        `const m = minimumOf(${JSON.stringify(engines)});` +
        `console.log(JSON.stringify([m, satisfies("v22.17.9", [22, 18]), satisfies("v22.18.0", [22, 18]), satisfies("v24.0.0", [22, 18])]));`,
    );
    expect(JSON.parse(out)).toEqual([engines.slice(2).split(".").map(Number), false, true, true]);
    for (const f of ["inventory.mjs", "impact.mjs"]) {
      const src = readFileSync(path.join(scripts, f), "utf8");
      expect(src, f).toContain("assertNodeVersion(");
      expect(src, f).not.toMatch(/process\.versions\.node/);
    }
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
