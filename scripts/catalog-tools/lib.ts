import { createHash } from "node:crypto";
import pg, { type Client } from "pg";

export type Args = Record<string, string | true>;

/** --key value / --flag. */
export function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
    else {
      out[a.slice(2)] = next;
      i++;
    }
  }
  return out;
}

export function str(args: Args, key: string, fallback?: string): string {
  const v = args[key];
  if (typeof v === "string") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`--${key} is required`);
}

/** CELLR's production Supabase project (docs/MIGRATIONS.md §3). These tools never write to it, whatever the flags. */
export const PRODUCTION_PROJECT_REFS: readonly string[] = ["vvelgyhbjfmjvxkzekyz"];

/** Staging projects an owner approved for imports, by Supabase project ref (scripts/catalog-tools/approved-targets.json). */
export interface ApprovedTargets {
  staging_project_refs: string[];
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * Where a tool may connect, decided from the URL before connecting:
 * - a local database (the pilot workflow); or
 * - a remote one only with `--staging-project <ref>`, where that ref is in the approved list, is not production, and
 *   the URL itself names that project (`db.<ref>.supabase.co`, or a Supabase pooler with user `postgres.<ref>`).
 * Any URL that mentions a production ref is refused. The database is then asked who it is (`assertTargetIdentity`).
 */
export function assertSafeTarget(
  url: string,
  args: Args,
  approved: ApprovedTargets,
): { local: boolean; ref: string | null } {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  const user = decodeURIComponent(u.username).toLowerCase();
  for (const prod of PRODUCTION_PROJECT_REFS)
    if (host.includes(prod) || user.includes(prod) || url.toLowerCase().includes(prod))
      throw new Error("refusing the production project: these tools never write to production");
  if (LOCAL_HOSTS.has(host)) return { local: true, ref: null };
  if (args["allow-remote-staging"] !== undefined)
    throw new Error(
      "--allow-remote-staging is no longer accepted: name the approved project with --staging-project <ref>",
    );
  const ref = args["staging-project"];
  if (typeof ref !== "string")
    throw new Error(
      `refusing ${host}: local databases only, or --staging-project <ref> for an approved staging project`,
    );
  if (!/^[a-z0-9]{8,40}$/.test(ref))
    throw new Error("--staging-project must be a Supabase project ref");
  if (PRODUCTION_PROJECT_REFS.includes(ref))
    throw new Error("refusing the production project: these tools never write to production");
  if (!approved.staging_project_refs.includes(ref))
    throw new Error(
      `project ${ref} is not an approved staging project (scripts/catalog-tools/approved-targets.json)`,
    );
  const names =
    host === `db.${ref}.supabase.co` ||
    (host.endsWith(".pooler.supabase.com") && user === `postgres.${ref}`);
  if (!names) throw new Error(`the database URL does not belong to project ${ref}`);
  return { local: false, ref };
}

/**
 * After connecting: the database must say it is a pilot or staging database (private.catalog_settings, set only by
 * its owner). An unmarked database is production and is refused; a remote one must also be the approved project.
 */
export async function assertTargetIdentity(
  client: Client,
  target: { local: boolean; ref: string | null },
): Promise<string> {
  const r = await client.query<{ id: { environment: string; project_ref: string | null } }>(
    "select public.catalog_target_identity() as id",
  );
  const { environment, project_ref } = r.rows[0]!.id;
  if (environment === "production")
    throw new Error("refusing: the target database says it is production");
  if (target.local && environment !== "pilot" && environment !== "staging")
    throw new Error(`refusing: unexpected environment ${environment}`);
  if (!target.local && (environment !== "staging" || project_ref !== target.ref))
    throw new Error(
      `refusing: the target says it is ${environment} ${project_ref ?? ""}, not staging project ${target.ref}`,
    );
  return environment;
}

export async function connect(url: string): Promise<Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Runs the rest of this connection as a signed-in person (row-level security applies), as PostgREST would. */
export async function actAs(client: Client, userId: string): Promise<void> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  await client.query(
    "select set_config('request.jwt.claims', $1, false), set_config('request.jwt.claim.sub', $2, false)",
    [claims, userId],
  );
  await client.query("set role authenticated");
}

export async function actAsService(client: Client): Promise<void> {
  await client.query(
    "select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false)",
  );
  await client.query("set role service_role");
}

export const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i]!;
}

/** Deterministic shuffle (mulberry32), so a run can be repeated exactly. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
