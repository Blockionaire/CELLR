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
  return {
    tables: tables(types),
    functions: functions(types),
    migrations: { count: migrationFiles.length, latest: migrationFiles.at(-1) ?? "" },
    buckets: buckets(sql),
    cronJobs: cronJobs(sql),
    vercelCrons: vercelCrons(root),
    apiRoutes: apiRoutes(root),
    serverModules: serverModules(root),
    ciJobs: ciJobs(read(".github/workflows/ci.yml")),
    features: features(read("packages/domain/src/features.ts")),
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
      .flatMap((l) => [...l.matchAll(/"([a-z][a-z0-9_]*)"/g)].map((m) => m[1]!)),
  );
}
