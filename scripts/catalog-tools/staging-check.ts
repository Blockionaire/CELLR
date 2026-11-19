/**
 * Is this database fit to receive a pilot import? (Sprint 004B) READ-ONLY: it reads the catalogue, permissions and
 * migration state and writes nothing.
 *
 *   pnpm --filter @cellr/catalog-tools exec tsx staging-check.ts --db <url> --expect staging|pilot
 *     [--staging-project <ref>] [--out <file>]
 *
 * It refuses to connect at all to production or to anything but a local database or an APPROVED staging project
 * (`target.ts`, unchanged). Once connected it checks, and exits non-zero when one fails:
 *   identity    the database itself says it is `--expect` (and, remotely, the approved project ref)
 *   schema      every repository migration is present (by its history, where there is one; else by its objects)
 *   gates       the pilot search, rights function, import functions and settings are not reachable by people or
 *               anonymous callers; the settings cannot be written by the service role; the pilot-scope trigger is on
 *   rls         row-level security is on for every catalogue table
 *   providers   no provider is public without verified rights; what each provider is set to
 */
import { readdirSync, writeFileSync } from "node:fs";
import { parseArgs, str } from "./lib";
import { connectToTarget } from "./target";

type Check = { name: string; ok: boolean; detail: string };

/** The repository's migration versions (the first 14 characters of each file name). */
export function repositoryVersions(dir: URL): string[] {
  return readdirSync(dir)
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .map((f) => f.slice(0, 14))
    .sort();
}

/** Versions the target lacks, and versions it has that the repository does not. */
export function compareVersions(repo: readonly string[], target: readonly string[]) {
  const t = new Set(target);
  const r = new Set(repo);
  return { missing: repo.filter((v) => !t.has(v)), extra: target.filter((v) => !r.has(v)) };
}

const PEOPLE_MUST_NOT_EXECUTE = [
  "public.catalog_search_pilot(uuid, text, text, text, text, integer)",
  "public.admin_catalog_provider_rights(text, jsonb, text, text)",
  "public.catalog_provider_register(jsonb)",
  "public.catalog_import_run_start(text, text, text, text, text, timestamp with time zone, boolean)",
  "public.catalog_external_import(text, uuid, jsonb, boolean)",
  "public.catalog_target_identity()",
  "public.admin_catalog_provider_disable(text, text, text, boolean)",
];
const CATALOGUE_TABLES = [
  "public.catalog_providers",
  "public.catalog_import_runs",
  "public.catalog_external_records",
  "public.catalog_record_links",
  "public.catalog_provider_rights_log",
  "private.catalog_search_entries",
  "private.catalog_settings",
];
/** Objects the newest catalogue migration relies on, for a database without a migration history (local). */
const REQUIRED_FUNCTIONS = [
  "public.catalog_search(uuid, text, text, text, text, integer)",
  "public.catalog_import_run_abandon(uuid, text)",
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const expect = str(args, "expect");
  if (expect !== "staging" && expect !== "pilot") throw new Error("--expect staging|pilot");
  const client = await connectToTarget(str(args, "db"), args);
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const one = async <T>(sql: string, values: unknown[] = []) =>
    (await client.query<T>(sql, values)).rows[0]!;
  try {
    const id = (
      await one<{ id: { environment: string; project_ref: string | null } }>(
        "select public.catalog_target_identity() as id",
      )
    ).id;
    add(
      "identity",
      id.environment === expect,
      `environment=${id.environment} project_ref=${id.project_ref ?? "-"}`,
    );
    if (typeof args["staging-project"] === "string")
      add(
        "identity: project ref",
        id.project_ref === args["staging-project"],
        `expected ${args["staging-project"]}`,
      );

    // schema: by history where there is one (a hosted project), else by the objects the newest migrations create
    const repo = repositoryVersions(new URL("../../supabase/migrations/", import.meta.url));
    const history = await client
      .query<{ version: string }>(
        "select version from supabase_migrations.schema_migrations order by 1",
      )
      .then((r) => r.rows.map((x) => x.version))
      .catch(() => null);
    if (history) {
      const { missing, extra } = compareVersions(repo, history);
      add(
        "schema: migration history",
        missing.length === 0 && extra.length === 0,
        `repository ${repo.length}, target ${history.length}; missing ${missing.join(",") || "none"}; extra ${extra.join(",") || "none"}`,
      );
    } else {
      const absent: string[] = [];
      for (const f of [...REQUIRED_FUNCTIONS, ...PEOPLE_MUST_NOT_EXECUTE])
        if (!(await one<{ ok: boolean }>("select to_regprocedure($1) is not null as ok", [f])).ok)
          absent.push(f);
      for (const t of CATALOGUE_TABLES)
        if (!(await one<{ ok: boolean }>("select to_regclass($1) is not null as ok", [t])).ok)
          absent.push(t);
      add(
        "schema: required objects (no migration history here)",
        absent.length === 0,
        absent.length
          ? `absent: ${absent.join(", ")}`
          : `all present; repository has ${repo.length} migrations`,
      );
    }

    // gates
    const leaks: string[] = [];
    for (const f of PEOPLE_MUST_NOT_EXECUTE)
      for (const role of ["anon", "authenticated"])
        if (
          (
            await one<{ ok: boolean }>(
              "select to_regprocedure($1) is not null and has_function_privilege($2, $1, 'EXECUTE') as ok",
              [f, role],
            )
          ).ok
        )
          leaks.push(`${role} → ${f}`);
    add(
      "gates: people cannot run pilot, rights or import functions",
      leaks.length === 0,
      leaks.join("; ") || "none reachable",
    );
    const settings = await one<{ w: boolean; r: boolean }>(
      "select has_table_privilege('service_role', 'private.catalog_settings', 'INSERT,UPDATE,DELETE') as w, has_table_privilege('authenticated', 'private.catalog_settings', 'SELECT') as r",
    );
    add(
      "gates: only the owner can mark the database",
      !settings.w && !settings.r,
      `service_role may write: ${settings.w}; authenticated may read: ${settings.r}`,
    );
    const guard = await one<{ ok: boolean }>(
      "select exists (select 1 from pg_trigger where tgname = 'catalog_providers_guard' and tgrelid = 'public.catalog_providers'::regclass and tgenabled <> 'D') as ok",
    );
    add(
      "gates: the pilot-scope trigger is enabled",
      guard.ok,
      guard.ok ? "on" : "missing or disabled",
    );

    // rls
    const off = (
      await client.query<{ t: string }>(
        `select n.nspname || '.' || c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where (n.nspname || '.' || c.relname) = any ($1) and not c.relrowsecurity`,
        [CATALOGUE_TABLES],
      )
    ).rows.map((r) => r.t);
    add(
      "rls: on for every catalogue table",
      off.length === 0,
      off.join(", ") || `${CATALOGUE_TABLES.length} tables`,
    );

    // providers
    const providers = (
      await client.query<{
        id: string;
        rights_status: string;
        search_scope: string;
        commercial_use: boolean;
        records: number;
      }>(
        `select p.id, p.rights_status, p.search_scope, p.commercial_use,
                (select count(*)::int from public.catalog_external_records e where e.provider_id = p.id and e.status = 'active') as records
           from public.catalog_providers p order by p.id`,
      )
    ).rows;
    const wrong = providers.filter(
      (p) => p.search_scope === "public" && !(p.rights_status === "verified" && p.commercial_use),
    );
    add(
      "providers: none public without verified commercial rights",
      wrong.length === 0,
      providers
        .map((p) => `${p.id}: ${p.rights_status}/${p.search_scope}/${p.records} records`)
        .join("; ") || "none registered",
    );
  } finally {
    await client.end();
  }
  const ok = checks.every((c) => c.ok);
  const report = { ok, expect, checks };
  console.log(JSON.stringify(report, null, 2));
  if (typeof args.out === "string") writeFileSync(args.out, JSON.stringify(report, null, 2) + "\n");
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
