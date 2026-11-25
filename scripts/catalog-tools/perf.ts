/**
 * Search load test (Sprint 004A): what a debounced autocomplete would send, against a local database.
 *
 *   pnpm --filter @cellr/catalog-tools perf --db <url> --user <uuid> --household <uuid>
 *     --set ../../eval/catalog/benchmark.json [--mode pilot|public] [--concurrency 8] [--rounds 3] [--out perf.json]
 *     [--max-clients <n>] [--pooler auto|session|transaction]
 *
 * Connections (Sprint 004C, pool.ts): the clients are opened one at a time and always closed, also on an error. A
 * concurrency above `--max-clients` is refused before anything is opened; through a Supabase session pooler the
 * limit must be given. `--pooler transaction` runs through the same pooler in transaction mode (port 6543): more
 * clients than session slots, each search in its own transaction with `set local role` (and, for a person, the
 * claims), as PostgREST does per request. Only the search statement is timed there.
 *
 * Each benchmark query is "typed": its first 3, 5 and 8 characters and the whole query, as separate searches
 * (what a 250 ms debounce sends for a person typing at a normal pace), plus each query with a filter. Every search
 * runs through the same search implementation:
 *   --mode pilot  (default) public.catalog_search_pilot as the service role, so pilot-scope provider records (the 100k
 *                 evaluation set) are searched; pilot or staging databases only;
 *   --mode public public.catalog_search as the signed-in person (row-level security and the membership check apply);
 *                 only 'public' providers are searched, so in a pilot database this measures CELLR's own wines only.
 * One warm-up pass is not counted. Latency is measured at the client: database time plus the round trip to the
 * database (on a remote target that includes the network), not the API layer. In transaction-pooler mode only the
 * search statement is timed; the begin and commit round trips are not, so fewer searches are in flight than there
 * are clients (throughput × mean latency gives the real number).
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { Client } from "pg";
import { actAs, parseArgs, percentile, shuffled, str } from "./lib";
import {
  assertClientLimit,
  closeAll,
  openClients,
  poolerOf,
  transactionPoolerUrl,
  transactionPreamble,
} from "./pool";
import { connectToTarget, connectToTargetForTransactions } from "./target";

interface Entry {
  id: string;
  query: string;
  /** Absent on filter, generic and adversarial entries (benchmark v2): those are not "typed" here. */
  expect?: { type: string; country: string };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = str(args, "db");
  const user = str(args, "user");
  const household = str(args, "household");
  const concurrency = Number(str(args, "concurrency", "8"));
  const rounds = Number(str(args, "rounds", "3"));
  // --subset 004a: only the 127 queries of Sprint 004A (b001–b127), for a like-for-like comparison with its numbers;
  // default: every entry that names a wine (the others are measured by benchmark.ts).
  const subset = str(args, "subset", "all");
  if (subset !== "all" && subset !== "004a") throw new Error("--subset all|004a");
  const entries = (
    JSON.parse(readFileSync(str(args, "set"), "utf8")) as { entries: Entry[] }
  ).entries
    .filter((e) => e.expect !== undefined)
    .filter((e) => subset === "all" || Number(e.id.slice(1)) <= 127);

  type Q = { q: string; type: string | null; country: string | null; bucket: string };
  const base: Q[] = [];
  for (const e of entries) {
    for (const n of [3, 5, 8])
      if (e.query.length > n)
        base.push({ q: e.query.slice(0, n), type: null, country: null, bucket: `prefix-${n}` });
    base.push({ q: e.query, type: null, country: null, bucket: "full" });
    base.push({
      q: e.query,
      type: e.expect!.type,
      country: e.expect!.country,
      bucket: "full+filters",
    });
  }
  // the household's own synthetic wines, and very common words (the widest candidate sets)
  for (const q of [
    "synthetic cuv",
    "chateau",
    "domaine",
    "reserva",
    "cabernet sauvignon",
    "pinot noir",
    "riesling",
    "brut",
  ])
    base.push({ q, type: null, country: null, bucket: "common-words" });

  const mode = str(args, "mode", "pilot");
  if (mode !== "pilot" && mode !== "public") throw new Error("--mode pilot|public");
  const fn = mode === "pilot" ? "public.catalog_search_pilot" : "public.catalog_search";
  const all: Array<{ ms: number; bucket: string; rows: number }> = [];
  let seconds = 0;
  // --pooler transaction: the same Supabase pooler in transaction mode, for more clients than its session slots
  const poolerArg = str(args, "pooler", "auto");
  if (poolerArg !== "auto" && poolerArg !== "session" && poolerArg !== "transaction")
    throw new Error("--pooler auto|session|transaction");
  const url = poolerArg === "transaction" ? transactionPoolerUrl(db) : db;
  const pooler = poolerOf(url);
  const perTransaction = pooler === "transaction";
  const maxClients = typeof args["max-clients"] === "string" ? Number(args["max-clients"]) : null;
  // before anything is opened: a configuration the target cannot serve is refused, never run with fewer clients
  assertClientLimit(concurrency, perTransaction ? null : maxClients, pooler);
  const preamble = perTransaction ? transactionPreamble(mode, user) : null;
  // every connection is checked against the allowed targets and the database's own identity; opened one at a time,
  // and all of them closed again whatever happens
  const clients = await openClients(concurrency, () =>
    perTransaction ? connectToTargetForTransactions(url, args) : connectToTarget(url, args),
  );
  try {
    if (mode === "public" && !perTransaction)
      for (const c of clients) {
        await c.query("reset role");
        await actAs(c, user);
      }
    const search = async (c: Client, item: Q) => {
      const sql = `select * from ${fn}($1, $2, $3, $4, null, 8)`;
      const params = [household, item.q, item.type, item.country];
      if (!preamble) {
        const t0 = performance.now();
        const r = await c.query(sql, params);
        return { ms: performance.now() - t0, rows: r.rows.length };
      }
      // one transaction per search; only the search statement is timed (the begin/commit round trips are the
      // pooler's cost, reported apart as throughput)
      try {
        await c.query(preamble);
        const t0 = performance.now();
        const r = await c.query(sql, params);
        const ms = performance.now() - t0;
        await c.query("commit");
        return { ms, rows: r.rows.length };
      } catch (e) {
        await c.query("rollback").catch(() => undefined);
        throw e;
      }
    };
    const run = async (list: Q[]) => {
      const times: Array<{ ms: number; bucket: string; rows: number }> = [];
      let next = 0;
      await Promise.all(
        clients.map(async (c) => {
          while (next < list.length) {
            const item = list[next++]!;
            times.push({ ...(await search(c, item)), bucket: item.bucket });
          }
        }),
      );
      return times;
    };
    await run(base); // warm-up
    const started = performance.now();
    for (let r = 0; r < rounds; r++) all.push(...(await run(shuffled(base, 4004 + r))));
    seconds = (performance.now() - started) / 1000;
  } finally {
    await closeAll(clients);
  }

  const stats = (list: typeof all) => {
    const ms = list.map((t) => t.ms).sort((a, b) => a - b);
    const round = (n: number) => Math.round(n * 10) / 10;
    return {
      n: ms.length,
      p50: round(percentile(ms, 50)),
      p95: round(percentile(ms, 95)),
      p99: round(percentile(ms, 99)),
      max: round(ms[ms.length - 1] ?? NaN),
      mean: round(ms.reduce((s, x) => s + x, 0) / ms.length),
      empty: list.filter((t) => t.rows === 0).length,
    };
  };
  const buckets = [...new Set(all.map((t) => t.bucket))];
  const report = {
    mode,
    subset,
    queries: entries.length,
    concurrency,
    pooler: pooler ?? "direct",
    rounds,
    searches: all.length,
    throughput_per_s: Math.round(all.length / seconds),
    overall: stats(all),
    by_bucket: Object.fromEntries(
      buckets.map((b) => [b, stats(all.filter((t) => t.bucket === b))]),
    ),
  };
  console.log(JSON.stringify(report, null, 2));
  if (typeof args.out === "string") writeFileSync(args.out, JSON.stringify(report, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
