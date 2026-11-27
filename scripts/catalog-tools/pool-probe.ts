/**
 * How many server connections the transaction pooler really gives at once (perf16's gate, staging-pilot.sh modes
 * pool-check and perf16). READ-ONLY: each client runs one transaction that holds its server connection for a while
 * (`pg_sleep`) and records, with the database server's clock, when it started and ended and on which backend; the
 * overlap (perf-accept.ts concurrencyOf) is how many PostgreSQL executed at once. Nothing is read or written.
 *
 *   tsx pool-probe.ts --db <url> --staging-project <ref> [--clients 24] [--need 16] [--hold-ms 2000] [--out f.json]
 *     exit 1 when fewer than --need ran at once: perf16 cannot show 16 concurrent searches through this pool
 */
import { writeFileSync } from "node:fs";
import type { Client } from "pg";
import { isLocalHost, parseArgs, str } from "./lib";
import { concurrencyOf } from "./perf-accept";
import { closeAll, openClients, transactionPoolerUrl } from "./pool";
import { connectToTargetForTransactions } from "./target";

export interface PoolProbe {
  clients: number;
  need: number;
  peak: number;
  backends: number;
  ok: boolean;
}

/** The verdict from what ran at once. Pure. */
export function judgePool(
  peak: number,
  backends: number,
  clients: number,
  need: number,
): PoolProbe {
  return {
    clients,
    need,
    peak,
    backends,
    ok: Number.isInteger(peak) && peak >= need && backends >= need,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = str(args, "db");
  const clients = Number(str(args, "clients", "24"));
  const need = Number(str(args, "need", "16"));
  const hold = Number(str(args, "hold-ms", "2000"));
  if (
    ![clients, need, hold].every((n) => Number.isInteger(n) && n > 0) ||
    hold > 10000 ||
    clients > 64
  )
    throw new Error(
      "--clients (1–64), --need and --hold-ms (up to 10000) must be positive whole numbers",
    );
  const local = isLocalHost(new URL(db).hostname);
  const url = local ? db : transactionPoolerUrl(db);
  const conns: Client[] = await openClients(clients, () =>
    connectToTargetForTransactions(url, args),
  );
  const intervals: Array<{ start: number; end: number; pid: number }> = [];
  try {
    // all clients send at the same moment; each holds a server connection for `hold` ms inside one transaction
    await Promise.all(
      conns.map(async (c) => {
        const res = (await c.query(
          "begin read only; " +
            "select (extract(epoch from clock_timestamp()) * 1000)::float8 as t, pg_backend_pid() as pid; " +
            `select pg_sleep(${hold / 1000}); ` +
            "select (extract(epoch from clock_timestamp()) * 1000)::float8 as t; commit",
        )) as unknown as Array<{ rows: Array<Record<string, unknown>> }>;
        const ts = res.filter((r) => r.rows[0] && "t" in r.rows[0]);
        intervals.push({
          start: Number(ts[0]?.rows[0]?.t),
          end: Number(ts[1]?.rows[0]?.t),
          pid: Number(ts[0]?.rows[0]?.pid),
        });
      }),
    );
  } finally {
    await closeAll(conns);
  }
  const c = concurrencyOf(intervals, need);
  const verdict = judgePool(c.peak, new Set(intervals.map((i) => i.pid)).size, clients, need);
  console.log(
    `pool probe: ${verdict.peak} of ${clients} clients ran at once in PostgreSQL on ${verdict.backends} backends ` +
      `(need ${need}): ${verdict.ok ? "OK" : "TOO FEW: the pooler's pool size limits it; raise it before perf16"}`,
  );
  if (typeof args.out === "string")
    writeFileSync(args.out, JSON.stringify(verdict, null, 2) + "\n");
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
