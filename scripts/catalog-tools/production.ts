/**
 * THE ONE ROUTE TO PRODUCTION for the catalogue tools (Wine Catalogue & Community Ratings, PR 4).
 *
 * Every catalogue tool refuses the production project (`lib.ts` assertSafeTarget). This module is the single,
 * separate exception, and only for import.ts and ratings.ts (records and ratings aggregates of a provider whose
 * rights the owner recorded in the database). It is used only when ALL of these hold, checked before connecting:
 *
 * - `--production <ref>` names CELLR's production project, and `--confirm <ref>` (typed by the person who started
 *   the run) is the same ref;
 * - it runs in GitHub Actions, started by hand (`workflow_dispatch`), on the reviewed `main`, inside the
 *   `cellr-production-catalog` environment (whose required reviewer is the owner: the approval of that run);
 * - the database URL names that project;
 * and after connecting:
 * - the database says it is production (no staging or pilot marker), and the provider's rights in the database
 *   allow the import (the import functions check again: a pilot run is impossible in production).
 *
 * It never registers a provider or changes rights, scope or feature switches: those stay the owner's own steps
 * (docs/sprints/ratings/ACTIVATION.md). The run checks (CI, event, branch, environment) are against ACCIDENTS: they
 * read environment variables a person could set. The control is the production URL itself, which exists only as a
 * secret of the cellr-production-catalog environment, released per run by its required reviewer.
 *
 * The URL may be given as `env:NAME` (the variable that holds it), so it never appears on a command line.
 */
import type { Client } from "pg";
import { actAsService, connect, PRODUCTION_PROJECT_REFS, type Args } from "./lib";

export const PRODUCTION_ENVIRONMENT = "cellr-production-catalog";

export interface ProductionRun {
  ci: boolean;
  event?: string | undefined;
  ref?: string | undefined;
  environment?: string | undefined;
}

/** What is wrong with this run for a production write (empty = go). Pure, for tests. */
export function productionProblems(url: string, args: Args, run: ProductionRun): string[] {
  const out: string[] = [];
  const ref = args.production;
  const prod = PRODUCTION_PROJECT_REFS[0]!;
  if (typeof ref !== "string" || ref !== prod)
    out.push("--production must name CELLR's production project");
  if (args.confirm !== ref) out.push("the typed confirmation is not the production project");
  if (args.pilot === true) out.push("a pilot run is never a production run");
  if (args["staging-project"] !== undefined)
    out.push("--staging-project and --production together");
  if (!run.ci) out.push("only inside the production workflow, never from a laptop");
  if (run.event !== "workflow_dispatch") out.push(`started by ${run.event ?? "?"}, not by hand`);
  if (run.ref !== "refs/heads/main") out.push(`runs ${run.ref ?? "?"}, not the reviewed main`);
  if (run.environment !== PRODUCTION_ENVIRONMENT)
    out.push(`not inside the ${PRODUCTION_ENVIRONMENT} environment (its approval was not given)`);
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const user = decodeURIComponent(u.username).toLowerCase();
    const names =
      host === `db.${prod}.supabase.co` ||
      (host.endsWith(".pooler.supabase.com") && user === `postgres.${prod}`);
    if (!names) out.push("the database URL does not belong to the production project");
    // the driver lets query parameters (host, user, port, …) override the URL: only sslmode is accepted
    const extra = [...u.searchParams.keys()].filter((k) => k !== "sslmode");
    if (extra.length > 0) out.push(`the database URL may not carry ${extra.join(", ")}`);
    // the session pooler only (5432): in transaction mode (6543) a session's role would not hold
    if (host.endsWith(".pooler.supabase.com") && u.port !== "5432")
      out.push("through the Supabase pooler only in session mode (port 5432)");
  } catch {
    out.push("the database URL cannot be read");
  }
  return out;
}

export const currentRun = (): ProductionRun => ({
  ci: process.env.GITHUB_ACTIONS === "true",
  event: process.env.GITHUB_EVENT_NAME,
  ref: process.env.GITHUB_REF,
  environment: process.env.CELLR_ENVIRONMENT,
});

/** Connects to production only on the conditions above, checks the database says it is production, acts as service role. */
/** `env:NAME` → the value of that environment variable; anything else as given. */
export const resolveDbUrl = (db: string): string =>
  db.startsWith("env:") ? (process.env[db.slice(4)] ?? "") : db;

export async function connectToProduction(
  dbArg: string,
  args: Args,
  run: ProductionRun = currentRun(),
): Promise<Client> {
  const url = resolveDbUrl(dbArg);
  const problems = productionProblems(url, args, run);
  if (problems.length > 0) throw new Error(`refusing production: ${problems.join("; ")}`);
  const client = await connect(url);
  try {
    const r = await client.query<{ id: { environment: string } }>(
      "select public.catalog_target_identity() as id",
    );
    if (r.rows[0]!.id.environment !== "production")
      throw new Error(
        `refusing: the database says it is ${r.rows[0]!.id.environment}, not production`,
      );
    await actAsService(client);
  } catch (e) {
    await client.end().catch(() => undefined);
    throw e;
  }
  return client;
}

/** The connection of an import tool: production only through the route above, anything else through target.ts. */
export async function connectForImport(url: string, args: Args): Promise<Client> {
  if (args.production !== undefined) return connectToProduction(url, args);
  const { connectToTarget } = await import("./target");
  return connectToTarget(resolveDbUrl(url), args);
}
