/**
 * The gate before every write to the staging project (Sprint 004C, `.github/workflows/staging-catalog.yml`).
 *
 *   pnpm --filter @cellr/catalog-tools exec tsx staging-guard.ts --phase migrate|write --db <url>
 *     --staging-project <ref> --confirm <ref typed by the person who started the run>
 *
 * Every catalogue tool already refuses production, an unapproved ref and a URL of another project, and asks the
 * database who it is (`target.ts`). This adds what only the run knows:
 * - the ref the person typed when starting the run is the configured one (no run against a project by accident);
 * - in GitHub Actions: a manual run (`workflow_dispatch`) of the reviewed `main`, in the `cellr-staging` environment;
 * - `migrate` (before the schema exists): the project is new or already CELLR staging — no households, no users,
 *   no migration history that is not the repository's — never a database with someone's data in it;
 * - `write` (everything else): the database itself says it is staging, with this ref (`connectToTarget`).
 * It writes nothing. Exit code 0 = go, anything else = stop.
 */
import { readdirSync } from "node:fs";
import { assertSafeTarget, connect, parseArgs, str } from "./lib";
import { approvedTargets, connectToTarget } from "./target";

export interface RunContext {
  ci: boolean;
  event?: string | undefined;
  ref?: string | undefined;
  environment?: string | undefined;
}

/** The run itself: who started it, from which code, in which environment. Pure, for tests. */
export function runProblems(ctx: RunContext, staging: string, confirm: string): string[] {
  const out: string[] = [];
  if (confirm !== staging)
    out.push(`the confirmation "${confirm}" is not the configured staging project`);
  if (ctx.ci) {
    if (ctx.event !== "workflow_dispatch") out.push(`started by ${ctx.event ?? "?"}, not by hand`);
    if (ctx.ref !== "refs/heads/main") out.push(`runs ${ctx.ref ?? "?"}, not the reviewed main`);
    if (ctx.environment !== "cellr-staging")
      out.push("not inside the cellr-staging environment (its approval was not given)");
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const phase = str(args, "phase");
  const url = str(args, "db");
  const ref = str(args, "staging-project");
  const problems = runProblems(
    {
      ci: process.env.GITHUB_ACTIONS === "true",
      event: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
      environment: process.env.CELLR_ENVIRONMENT,
    },
    ref,
    str(args, "confirm"),
  );
  // the URL: never production, an approved ref, and the URL names that project (throws otherwise)
  const target = assertSafeTarget(url, args, approvedTargets());
  if (target.local) problems.push("a local database is not the staging project");
  if (problems.length > 0) throw new Error(problems.join("; "));

  if (phase === "migrate") {
    const client = await connect(url);
    try {
      const q = async (sql: string) => (await client.query<{ v: unknown }>(sql)).rows[0]?.v;
      const marked = await q("select to_regclass('private.catalog_settings') is not null as v");
      if (marked) {
        // already set up: it must say it is this staging project (connectToTarget asks it)
        await client.end();
        (await connectToTarget(url, args)).end();
      } else {
        const people = Number(
          await q(
            "select coalesce((select count(*) from auth.users), 0) + coalesce((select count(*) from pg_class where relname = 'households' and relnamespace = 'public'::regnamespace), 0) as v",
          ),
        );
        if (people > 0)
          throw new Error("refusing: the database has users or CELLR tables but no staging marker");
        const repo = new Set(
          readdirSync(new URL("../../supabase/migrations/", import.meta.url))
            .filter((f) => f.endsWith(".sql"))
            .map((f) => f.slice(0, 14)),
        );
        const history = await client
          .query<{ version: string }>("select version from supabase_migrations.schema_migrations")
          .then((r) => r.rows.map((x) => x.version))
          .catch(() => [] as string[]);
        const foreign = history.filter((v) => !repo.has(v));
        if (foreign.length > 0)
          throw new Error(
            `refusing: migration history not from this repository (${foreign.join(",")})`,
          );
      }
    } finally {
      await client.end().catch(() => undefined);
    }
  } else if (phase === "write") {
    await (await connectToTarget(url, args)).end();
  } else throw new Error("--phase migrate|write");
  console.log(`staging guard (${phase}): go for project ${ref}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  main().catch((e) => {
    console.error(`staging guard: STOP: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
