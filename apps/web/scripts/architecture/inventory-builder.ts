import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { RepositoryInventory } from "@cellr/domain";

/**
 * THE REPOSITORY INVENTORY (System Intelligence ADR-001): facts read from the repository itself, which the
 * architecture register is checked against. Used by `pnpm architecture:inventory` (writes
 * inventory.generated.json) and by registry.test.ts (fails when the committed file is stale).
 *
 * Runs under plain Node (type stripping): node built-ins and type-only imports, nothing else. Deterministic: every
 * list is sorted, nothing depends on time or the machine.
 */
export function buildInventory(root: string): RepositoryInventory {
  const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
  const types = read("apps/web/src/server/db/database.types.ts");
  const migrationFiles = readdirSync(path.join(root, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const sql = migrationFiles.map((f) => read(`supabase/migrations/${f}`));
  const tableList = tables(types);
  const code = sourceFiles(root);
  return {
    tables: tableList,
    functions: functions(types),
    migrations: { count: migrationFiles.length, latest: migrationFiles.at(-1) ?? "" },
    buckets: buckets(sql),
    cronJobs: cronJobs(sql),
    vercelCrons: vercelCrons(root),
    apiRoutes: apiRoutes(root),
    serverModules: serverModules(root),
    ciJobs: ciJobs(read(".github/workflows/ci.yml")),
    features: features(read("packages/domain/src/features.ts")),
    workflows: workflows(root),
    envVars: envVars(code),
    externalHosts: externalHosts(code),
    dependencies: dependencies(root),
    dataAccess: dataAccess(code, new Set(tableList.map((t) => t.name))),
    imports: imports(code),
  };
}

const sorted = <T>(xs: Iterable<T>, key: (x: T) => string = String) =>
  [...xs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

/** The `public` schema's section of the generated types, between two of its keys. */
function section(types: string, from: string, to: string): string {
  const schema = types.slice(types.indexOf("  public: {"));
  const start = schema.indexOf(`    ${from}: {`);
  const end = schema.indexOf(`    ${to}: {`, start);
  if (start < 0 || end < 0) throw new Error(`database.types.ts: no public ${from} section`);
  return schema.slice(start, end);
}

/** Tables and the tables their foreign keys point at (from the generated types' Relationships). */
function tables(types: string): RepositoryInventory["tables"] {
  const block = section(types, "Tables", "Views");
  const heads = [...block.matchAll(/^ {6}([a-z_0-9]+): \{$/gm)];
  return sorted(
    heads.map((h, i) => {
      const body = block.slice(h.index, heads[i + 1]?.index ?? block.length);
      const refs = new Set(
        [...body.matchAll(/referencedRelation: "([a-z_0-9]+)"/g)].map((m) => m[1]!),
      );
      return { name: h[1]!, references: sorted(refs) };
    }),
    (t) => t.name,
  );
}

function functions(types: string): string[] {
  const block = section(types, "Functions", "Enums");
  return sorted(new Set([...block.matchAll(/^ {6}([a-z_0-9]+):/gm)].map((m) => m[1]!)));
}

/** Bucket ids inserted into storage.buckets by any migration. */
function buckets(sql: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const file of sql)
    for (const stmt of file.matchAll(/insert\s+into\s+storage\.buckets[\s\S]*?;/gi))
      for (const m of stmt[0].matchAll(/\(\s*'([a-z0-9-]+)'/g)) ids.add(m[1]!);
  return sorted(ids);
}

const CRON = /^(\S+\s+){4}\S+$|^\d+ seconds$/;

/** pg_cron jobs as the migrations leave them, in order: a later schedule replaces, an unschedule removes. */
function cronJobs(sql: readonly string[]): RepositoryInventory["cronJobs"] {
  const jobs = new Map<string, string>();
  for (const file of sql)
    for (const m of file.matchAll(
      /cron\.(schedule|unschedule)\(\s*'([^']+)'(?:\s*,\s*'([^']+)')?/g,
    )) {
      if (m[1] === "schedule" && m[3]) {
        // a job without a name (`schedule(schedule, command)`) would put its command here: refuse, never publish it
        if (!CRON.test(m[3]))
          throw new Error(`pg_cron job "${m[2]}": "${m[3]}" is not a cron schedule`);
        jobs.set(m[2]!, m[3]);
      } else if (m[1] === "unschedule") jobs.delete(m[2]!);
    }
  return sorted(jobs, ([name]) => name).map(([name, schedule]) => ({ name, schedule }));
}

function vercelCrons(root: string): RepositoryInventory["vercelCrons"] {
  const file = path.join(root, "apps/web/vercel.json");
  if (!existsSync(file)) return [];
  const json = JSON.parse(readFileSync(file, "utf8")) as {
    crons?: Array<{ path: string; schedule: string }>;
  };
  return sorted(
    (json.crons ?? []).map(({ path: p, schedule }) => ({ path: p, schedule })),
    (c) => c.path,
  );
}

/** Files under a directory; symbolic links are not followed. */
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.isFile() ? [p] : [];
  });

/** Every route handler under app/api, as its URL path, with the HTTP methods it exports. */
function apiRoutes(root: string): RepositoryInventory["apiRoutes"] {
  const base = path.join(root, "apps/web/src/app/api");
  return sorted(
    walk(base)
      .filter((f) => path.basename(f) === "route.ts")
      .map((f) => {
        const dir = path.relative(base, path.dirname(f)).split(path.sep).join("/");
        const methods = [
          ...readFileSync(f, "utf8").matchAll(
            /^export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b/gm,
          ),
        ].map((m) => m[1]!);
        return { path: `/api/${dir}`, methods: sorted(new Set(methods)) };
      }),
    (r) => r.path,
  );
}

/** The server's modules: each directory under src/server ("…/scans/") and each top-level file. */
function serverModules(root: string): string[] {
  const rel = "apps/web/src/server";
  return sorted(
    readdirSync(path.join(root, rel))
      .filter((f) => {
        const p = path.join(root, rel, f);
        return statSync(p).isDirectory() || (/\.ts$/.test(f) && !/\.(test|d)\.ts$/.test(f));
      })
      .map((f) =>
        statSync(path.join(root, rel, f)).isDirectory() ? `${rel}/${f}/` : `${rel}/${f}`,
      ),
  );
}

/** Job ids of the CI workflow (two-space keys under `jobs:`). */
function ciJobs(yml: string): string[] {
  const jobs = yml.slice(yml.indexOf("\njobs:"));
  return sorted([...jobs.matchAll(/^ {2}([a-z0-9-]+):\s*$/gm)].map((m) => m[1]!));
}

function features(source: string): string[] {
  const start = source.indexOf("export const FEATURES = [");
  const end = source.indexOf("] as const", start);
  if (start < 0 || end < 0) throw new Error("features.ts: no FEATURES list");
  return sorted(
    source
      .slice(start, end)
      .split("\n")
      .filter((l) => !l.trim().startsWith("/") && !l.trim().startsWith("*"))
      .flatMap((l) => [...l.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!)),
  );
}

// ---- Sprint "architecture stays current": what the code itself says it uses -----------------------------------------

/** The app's own source files (no tests, no type declarations), repository-relative, with their text. */
type SourceFile = { readonly rel: string; readonly text: string };
const APP_SRC = "apps/web/src/";

function sourceFiles(root: string): SourceFile[] {
  return walk(path.join(root, APP_SRC))
    .map((f) => path.relative(root, f).split(path.sep).join("/"))
    .filter((rel) => /\.(ts|tsx)$/.test(rel) && !/\.(test|spec|d)\.tsx?$/.test(rel))
    .sort()
    .map((rel) => ({ rel, text: readFileSync(path.join(root, rel), "utf8") }));
}

/**
 * The area a file belongs to, for the links below: a directory under src two levels deep ("server/cellar/",
 * "app/api/", "features/admin/") or the file itself when it sits higher ("server/http.ts", "lib/photo.ts").
 */
export function areaOf(rel: string): string {
  const inner = rel.startsWith(APP_SRC) ? rel.slice(APP_SRC.length) : rel;
  const parts = inner.split("/");
  return parts.length > 2 ? `${parts[0]}/${parts[1]}/` : inner;
}

/** GitHub Actions workflows and their job ids. */
function workflows(root: string): RepositoryInventory["workflows"] {
  const dir = path.join(root, ".github/workflows");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => ({
      file: `.github/workflows/${f}`,
      jobs: ciJobs(readFileSync(path.join(dir, f), "utf8")),
    }));
}

/**
 * Environment variables the app reads: process.env.X, env.X, env["X"], and the keys of a zod schema in a file that
 * parses process.env (names only, never values).
 */
function envVars(code: readonly SourceFile[]): string[] {
  const names = new Set<string>();
  for (const f of code)
    for (const m of f.text.matchAll(
      /\b(?:process\.env|env)(?:\.([A-Z][A-Z0-9_]{2,})|\[\s*["']([A-Z][A-Z0-9_]{2,})["']\s*\])/g,
    ))
      names.add((m[1] ?? m[2])!);
  // a zod schema that parses process.env names its variables as keys
  for (const f of code)
    if (f.text.includes("process.env"))
      for (const m of f.text.matchAll(/^\s*([A-Z][A-Z0-9_]{2,}):\s*z\./gm)) names.add(m[1]!);
  return sorted(names);
}

/** Placeholder and test domains, which name no real integration. */
const NOT_A_HOST =
  /(^|\.)(example|test|invalid|localhost)$|^example\.(com|org|net|nl)$|^www\.example\./;

/**
 * External hosts named in the app's code as https:// literals (an integration's fixed address). Supabase project
 * hosts are collapsed to "*.supabase.co": which project is configuration, not architecture. The register itself and
 * its UI are left out: they only quote these hosts.
 */
function externalHosts(code: readonly SourceFile[]): string[] {
  const hosts = new Set<string>();
  for (const f of code) {
    if (f.rel.startsWith(`${APP_SRC}server/system/`)) continue;
    for (const m of f.text.matchAll(/https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/g)) {
      const host = m[1]!.endsWith(".supabase.co") ? "*.supabase.co" : m[1]!;
      if (!NOT_A_HOST.test(host) && !host.endsWith(".app.github.dev")) hosts.add(host);
    }
  }
  return sorted(hosts);
}

/** Runtime dependencies of what is deployed (the web app and the domain package), workspace packages left out. */
function dependencies(root: string): string[] {
  const names = new Set<string>();
  for (const pkg of ["apps/web/package.json", "packages/domain/package.json"]) {
    const json = JSON.parse(readFileSync(path.join(root, pkg), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    for (const [name, version] of Object.entries(json.dependencies ?? {}))
      if (!version.startsWith("workspace:")) names.add(name);
  }
  return sorted(names);
}

/** Which area reads or writes which table: `.from("table")` calls on tables the migrations create. */
function dataAccess(
  code: readonly SourceFile[],
  tableNames: ReadonlySet<string>,
): RepositoryInventory["dataAccess"] {
  const seen = new Map<string, { area: string; table: string }>();
  for (const f of code) {
    if (f.rel.startsWith(`${APP_SRC}server/system/`)) continue; // the register's evidence, not access
    for (const m of f.text.matchAll(/\.from\(\s*["']([a-z_0-9]+)["']\s*\)/g))
      if (tableNames.has(m[1]!)) {
        const link = { area: areaOf(f.rel), table: m[1]! };
        seen.set(`${link.area} ${link.table}`, link);
      }
  }
  return sorted(seen.values(), (l) => `${l.area} ${l.table}`);
}

/**
 * The module specifiers a file imports at run time: static imports and re-exports, and dynamic import(). Imports
 * of types only (`import type`, or every name marked `type`) are left out: they couple no behaviour.
 */
export function runtimeImports(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(
    /^\s*(?:import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/gm,
  )) {
    if (m[1]) continue;
    const braces = /\{([\s\S]*)\}/.exec(m[2]!)?.[1];
    const names = braces
      ?.split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    const onlyTypes =
      names &&
      names.length > 0 &&
      names.every((n) => n.startsWith("type ")) &&
      !/^\s*\w+\s*,/.test(m[2]!);
    if (!onlyTypes) out.push(m[3]!);
  }
  for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]!);
  for (const m of text.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push(m[1]!);
  return out;
}

/** Resolves an "@/…" or relative specifier to one of the app's files; null for packages and anything else. */
export function resolveImport(
  from: string,
  spec: string,
  files: ReadonlySet<string>,
): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = APP_SRC + spec.slice(2);
  else if (spec.startsWith("."))
    base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`])
    if (files.has(c)) return c;
  return null;
}

/** Which area uses which other area at run time (from the imports above). */
function imports(code: readonly SourceFile[]): RepositoryInventory["imports"] {
  const files = new Set(code.map((f) => f.rel));
  const seen = new Map<string, { from: string; to: string }>();
  for (const f of code)
    for (const spec of runtimeImports(f.text)) {
      const target = resolveImport(f.rel, spec, files);
      if (!target) continue;
      const link = { from: areaOf(f.rel), to: areaOf(target) };
      if (link.from !== link.to) seen.set(`${link.from} ${link.to}`, link);
    }
  return sorted(seen.values(), (l) => `${l.from} ${l.to}`);
}
