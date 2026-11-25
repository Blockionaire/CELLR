/**
 * Connections for the load test (perf.ts), opened and closed so that none is ever left behind (Sprint 004C, staging
 * run 45039275216: the Supabase session pooler allows 15 clients; 16 were opened at once, the 16th was refused
 * with EMAXCONNSESSION and the 15 already open were never closed).
 *
 * - The number of clients is checked BEFORE anything is opened: a load test that cannot get its clients is not
 *   run (never silently with fewer, which would report a lower concurrency than it claims).
 * - Clients are opened one at a time; if one fails, every client opened so far is closed before the error is passed
 *   on. `closeAll` closes every client and never throws.
 * - Through a Supabase pooler in SESSION mode (port 5432) each client holds one pooler slot, so `--max-clients`
 *   (the project's pool size) must be given. TRANSACTION mode (port 6543) shares the database connections between
 *   clients per transaction: it allows more clients than slots, but no session state, so each search runs in its
 *   own transaction with `set local` (as PostgREST does per request). That is the route for concurrency above the
 *   pool size; the security model is the same (the same roles, RLS and grants), nothing is bypassed.
 */
import type { Client } from "pg";

export type PoolerMode = "session" | "transaction";

/** What the URL says about the pooler: a Supabase pooler host on 5432 (session) or 6543 (transaction), else none. */
export function poolerOf(url: string): PoolerMode | null {
  const u = new URL(url);
  if (!u.hostname.toLowerCase().endsWith(".pooler.supabase.com")) return null;
  return u.port === "6543" ? "transaction" : "session";
}

/** The same Supabase pooler URL in transaction mode (port 6543). Only for a Supabase pooler host. */
export function transactionPoolerUrl(url: string): string {
  if (poolerOf(url) === null)
    throw new Error("--pooler transaction needs a Supabase pooler URL (*.pooler.supabase.com)");
  const u = new URL(url);
  u.port = "6543";
  return u.toString();
}

/**
 * Refuses a test configuration the target cannot serve, before any connection is opened. Through a session pooler
 * the limit must be known (`--max-clients`); a concurrency above it is refused, never reduced.
 */
export function assertClientLimit(
  concurrency: number,
  maxClients: number | null,
  pooler: PoolerMode | null,
): void {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error("--concurrency must be a whole number of at least 1");
  if (maxClients !== null && (!Number.isInteger(maxClients) || maxClients < 1))
    throw new Error("--max-clients must be a whole number of at least 1");
  if (pooler === "session" && maxClients === null)
    throw new Error(
      "a Supabase session pooler allows only its pool size in clients: pass --max-clients <pool size>",
    );
  if (maxClients !== null && concurrency > maxClients)
    throw new Error(
      `concurrency ${concurrency} needs ${concurrency} clients, but the target allows ${maxClients}` +
        (pooler === "session" ? " (session pooler): use --pooler transaction for more" : ""),
    );
}

/** Closes every client; a client that cannot be closed (already gone) is not an error. */
export async function closeAll(clients: readonly Client[]): Promise<void> {
  await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
}

/**
 * Opens `n` clients one after another with `open`. If any fails, those already open are closed and the error is
 * thrown: the caller never holds a partial set.
 */
export async function openClients(n: number, open: () => Promise<Client>): Promise<Client[]> {
  const clients: Client[] = [];
  try {
    for (let i = 0; i < n; i++) clients.push(await open());
    return clients;
  } catch (e) {
    await closeAll(clients);
    const why = e instanceof Error ? e.message : String(e);
    throw new Error(
      `could not open client ${clients.length + 1} of ${n}: ${why} (all ${clients.length} closed)`,
    );
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The statements that open one search transaction in transaction-pooler mode: the role (and, for a person, the
 * claims) for this transaction only. The user id is checked to be a uuid before it is written into the statement.
 */
export function transactionPreamble(mode: "pilot" | "public", userId: string): string {
  if (mode === "pilot") return "begin; set local role service_role";
  if (!UUID.test(userId)) throw new Error("--user must be a uuid");
  const claims = JSON.stringify({ sub: userId, role: "authenticated" }).replaceAll("'", "''");
  return (
    "begin; set local role authenticated; " +
    `select set_config('request.jwt.claims', '${claims}', true), set_config('request.jwt.claim.sub', '${userId}', true)`
  );
}
