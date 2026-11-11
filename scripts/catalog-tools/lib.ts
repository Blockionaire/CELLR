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

/**
 * These tools write staging data: they refuse anything but a local database unless explicitly told the target is a
 * staging project. They never run against production (docs/MIGRATIONS.md; Sprint 004A scope).
 */
export function assertSafeTarget(url: string, args: Args): void {
  const host = new URL(url).hostname;
  const local = ["127.0.0.1", "localhost", "::1"].includes(host);
  if (!local && args["allow-remote-staging"] !== true)
    throw new Error(
      `refusing to write to ${host}: local databases only (pass --allow-remote-staging for a staging project)`,
    );
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
