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
 * are clients.
 *
 * perf16 (--one-trip, GO_LIVE.md A3): concurrency is MEASURED inside PostgreSQL, not inferred. Each search records
 * its start and end with the database server's clock and its backend pid; the overlap of those intervals is how many
 * searches PostgreSQL executed at once (perf-accept.ts concurrencyOf). --target names the number to show (16);
 * --concurrency is the number of CLIENTS, which may be higher to keep the target executing despite the round trip.
 * --sample-activity adds an independent sampler of pg_stat_activity on its own session connection, and the resource
 * use of the measured rounds (pg_stat_statements for the search, pg_stat_database) as before/after deltas.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { Client } from "pg";
import { actAs, isLocalHost, parseArgs, percentile, shuffled, str } from "./lib";
import { measuredFields, type Interval } from "./perf-accept";
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

export interface Resources {
  at: number;
  statements: {
    calls: number;
    exec_ms: number;
    blks_hit: number;
    blks_read: number;
    temp_written: number;
  } | null;
  database: {
    xact: number;
    blks_hit: number;
    blks_read: number;
    temp_bytes: number;
    backends: number;
  };
}

/**
 * pg_stat_statements for the search (when installed) and pg_stat_database, read as the login role. `pattern` picks
 * the top-level search statements (default: the people's search; ladder.ts passes the path it measures).
 */
export async function snapshot(
  c: Client,
  pattern = "%public.catalog_search(%",
): Promise<Resources> {
  const db = (
    await c.query<Resources["database"]>(
      `select (xact_commit + xact_rollback)::float8 as xact, blks_hit::float8, blks_read::float8, temp_bytes::float8,
              numbackends::float8 as backends
         from pg_stat_database where datname = current_database()`,
    )
  ).rows[0]!;
  let statements: Resources["statements"] = null;
  try {
    statements = (
      await c.query<NonNullable<Resources["statements"]>>(
        `select coalesce(sum(calls), 0)::float8 as calls, coalesce(sum(total_exec_time), 0)::float8 as exec_ms,
                coalesce(sum(shared_blks_hit), 0)::float8 as blks_hit, coalesce(sum(shared_blks_read), 0)::float8 as blks_read,
                coalesce(sum(temp_blks_written), 0)::float8 as temp_written
           from pg_stat_statements where toplevel and query like $1`,
        // a parameter, so this snapshot's own normalised text never matches; only the top-level search
        [pattern],
      )
    ).rows[0]!;
  } catch {
    statements = null; // not installed or not readable: reported as null, never guessed
  }
  return { at: Date.now(), statements, database: db };
}

export function resourcesDelta(a: Resources | null, b: Resources | null) {
  if (!a || !b) return null;
  const d = (x: number, y: number) => Math.round(y - x);
  const hitRatio = (hit: number, read: number) =>
    hit + read > 0 ? Math.round((hit / (hit + read)) * 10000) / 100 : null;
  const dbHit = d(a.database.blks_hit, b.database.blks_hit);
  const dbRead = d(a.database.blks_read, b.database.blks_read);
  return {
    seconds: Math.round((b.at - a.at) / 100) / 10,
    database: {
      transactions: d(a.database.xact, b.database.xact),
      blocks_hit: dbHit,
      blocks_read: dbRead,
      cache_hit_percent: hitRatio(dbHit, dbRead),
      temp_bytes: d(a.database.temp_bytes, b.database.temp_bytes),
      backends_after: b.database.backends,
    },
    search_statements:
      a.statements && b.statements
        ? {
            calls: d(a.statements.calls, b.statements.calls),
            exec_ms: d(a.statements.exec_ms, b.statements.exec_ms),
            blocks_hit: d(a.statements.blks_hit, b.statements.blks_hit),
            blocks_read: d(a.statements.blks_read, b.statements.blks_read),
            cache_hit_percent: hitRatio(
              b.statements.blks_hit - a.statements.blks_hit,
              b.statements.blks_read - a.statements.blks_read,
            ),
            temp_blocks_written: d(a.statements.temp_written, b.statements.temp_written),
          }
        : null,
  };
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

  // --synthetic <provider>: queries made from that provider's own records (CELLR's synthetic load set), so people's
  // search over a populated PUBLIC source is measured with hits, not only with empty answers
  const synthetic = typeof args.synthetic === "string" ? args.synthetic : null;
  if (synthetic !== null && !/^[a-z][a-z0-9_]{1,30}$/.test(synthetic))
    throw new Error("--synthetic <provider id>");
  // --one-trip (transaction pooler only): begin, role, search and commit in ONE round trip, timed inside the database
  // (clock_timestamp around the search) as well as at the client, so every client keeps a search in flight
  const oneTrip = args["one-trip"] === true;
  const target = Number(str(args, "target", "16"));
  if (!Number.isInteger(target) || target < 1)
    throw new Error("--target must be a whole number of at least 1");
  const sampleActivity = args["sample-activity"] === true;
  if (sampleActivity && !oneTrip) throw new Error("--sample-activity needs --one-trip");
  const intervals: Array<Interval & { pid: number }> = [];
  let measuring = false;
  let syntheticHits = 0;
  const mode = str(args, "mode", "pilot");
  if (mode !== "pilot" && mode !== "public") throw new Error("--mode pilot|public");
  const fn = mode === "pilot" ? "public.catalog_search_pilot" : "public.catalog_search";
  const all: Array<{
    ms: number;
    clientMs?: number;
    bucket: string;
    rows: number;
    synthetic?: number;
  }> = [];
  let seconds = 0;
  let sampler: {
    samples: number;
    max_active: number;
    mean_active: number;
    mean_without_wait: number;
    note: string;
  } | null = null;
  let resourcesBefore: Resources | null = null;
  let resourcesAfter: Resources | null = null;
  // --pooler transaction: the same Supabase pooler in transaction mode, for more clients than its session slots
  const poolerArg = str(args, "pooler", "auto");
  if (poolerArg !== "auto" && poolerArg !== "session" && poolerArg !== "transaction")
    throw new Error("--pooler auto|session|transaction");
  // a LOCAL database has no pooler: --pooler transaction then runs the same one-transaction-per-search path against
  // it directly (for the tool's own tests; target.ts still refuses anything but local or approved staging)
  const local = isLocalHost(new URL(db).hostname);
  const url = poolerArg === "transaction" && !local ? transactionPoolerUrl(db) : db;
  const pooler = poolerOf(url);
  const perTransaction = pooler === "transaction" || (poolerArg === "transaction" && local);
  const maxClients = typeof args["max-clients"] === "string" ? Number(args["max-clients"]) : null;
  // before anything is opened: a configuration the target cannot serve is refused, never run with fewer clients
  assertClientLimit(concurrency, perTransaction ? null : maxClients, pooler);
  if (oneTrip && !perTransaction) throw new Error("--one-trip needs --pooler transaction");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(household))
    throw new Error("--household must be a uuid");
  const preamble = perTransaction ? transactionPreamble(mode, user) : null;
  // every connection is checked against the allowed targets and the database's own identity; opened one at a time,
  // and all of them closed again whatever happens
  const clients = await openClients(concurrency, () =>
    perTransaction ? connectToTargetForTransactions(url, args) : connectToTarget(url, args),
  );
  try {
    if (synthetic !== null) {
      // read as the service role (the pooler connection sets it per transaction, a session connection has it)
      const c = clients[0]!;
      const read = `select producer || ' ' || name as q, wine_type::text as type, country_code as country
                      from public.catalog_external_records where provider_id = $1 and status = 'active'
                     order by md5(id::text) limit 300`;
      type Row = { q: string; type: string | null; country: string | null };
      let rows: Row[];
      if (perTransaction) {
        const multi = `begin; set local role service_role; ${read.replace("$1", () => c.escapeLiteral(synthetic))}; commit`;
        const res = (await c.query(multi)) as unknown as Array<{ rows: Row[] }>;
        rows = res[2]!.rows;
      } else rows = (await c.query<Row>(read, [synthetic])).rows;
      if (rows.length === 0) throw new Error(`no records of ${synthetic}`);
      base.length = 0;
      rows.forEach((r, i) => {
        const q = r.q.toLowerCase();
        for (const n of [3, 5, 8])
          base.push({ q: q.slice(0, n), type: null, country: null, bucket: `prefix-${n}` });
        base.push({ q, type: null, country: null, bucket: "full" });
        base.push({ q, type: r.type, country: r.country, bucket: "full+filters" });
        // a typo: two neighbouring letters swapped in the middle
        const k = Math.max(1, Math.floor(q.length / 2) - (i % 3));
        base.push({
          q: q.slice(0, k) + (q[k + 1] ?? "") + (q[k] ?? "") + q.slice(k + 2),
          type: null,
          country: null,
          bucket: "typo",
        });
      });
    }
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
      if (oneTrip) {
        // one round trip: everything as literals (the uuid is checked, the text escaped by the driver)
        const lit = (v: string | null) => (v === null ? "null" : c.escapeLiteral(v));
        const text =
          `${preamble}; select (extract(epoch from clock_timestamp()) * 1000)::float8 as t, pg_backend_pid() as pid; ` +
          `select count(*)::int as n, count(*) filter (where provider_id = ${lit(synthetic)})::int as s ` +
          `from ${fn}(${lit(household)}::uuid, ${lit(item.q)}, ${lit(item.type)}, ${lit(item.country)}, null, 8); ` +
          `select (extract(epoch from clock_timestamp()) * 1000)::float8 as t; commit`;
        const t0 = performance.now();
        try {
          const res = (await c.query(text)) as unknown as Array<{
            rows: Array<Record<string, unknown>>;
          }>;
          const clientMs = performance.now() - t0;
          const at = (r: { rows: Array<Record<string, unknown>> } | undefined) =>
            Number(r?.rows[0]?.t);
          // results: begin, set role, [claims], t0, search, t1, commit
          const ts = res.filter((r) => r.rows[0] && "t" in r.rows[0]);
          const found = res.find((r) => r.rows[0] && "n" in r.rows[0])?.rows[0];
          const n = Number(found?.n ?? 0);
          const hits = Number(found?.s ?? 0);
          const start = at(ts[0]);
          const end = at(ts[1]);
          if (measuring) intervals.push({ start, end, pid: Number(ts[0]?.rows[0]?.pid) });
          return { ms: end - start, clientMs, rows: n, synthetic: hits };
        } catch (e) {
          await c.query("rollback").catch(() => undefined);
          throw e;
        }
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
      const times: Array<{
        ms: number;
        clientMs?: number;
        bucket: string;
        rows: number;
        synthetic?: number;
      }> = [];
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
    // the sampler and the resource snapshots: one more SESSION connection, as the login role (pg_read_all_stats)
    let probe: Client | null = null;
    let stopSampler = () => Promise.resolve();
    if (sampleActivity) {
      probe = await connectToTarget(db, args);
      await probe.query("reset role");
      resourcesBefore = await snapshot(probe);
      const samples: number[] = [];
      // active with no wait event: on a CPU or waiting for one (a 2-vCPU database runs at most 2 at once)
      const onCpu: number[] = [];
      let on = true;
      const loop = (async () => {
        while (on) {
          const r = await probe!.query<{ n: number; cpu: number }>(
            `select count(*)::int as n, count(*) filter (where wait_event_type is null)::int as cpu
               from pg_stat_activity
              where state = 'active' and backend_type = 'client backend' and pid <> pg_backend_pid()
                and query like '%' || $1 || '(%'`,
            [fn],
          );
          samples.push(r.rows[0]!.n);
          onCpu.push(r.rows[0]!.cpu);
          await new Promise((ok) => setTimeout(ok, 50));
        }
      })();
      stopSampler = async () => {
        on = false;
        await loop;
        sampler = {
          samples: samples.length,
          max_active: Math.max(0, ...samples),
          mean_active: samples.length
            ? Math.round((samples.reduce((a, x) => a + x, 0) / samples.length) * 10) / 10
            : 0,
          mean_without_wait: onCpu.length
            ? Math.round((onCpu.reduce((a, x) => a + x, 0) / onCpu.length) * 10) / 10
            : 0,
          note: "a whole one-trip message counts as active: an upper bound, a cross-check of the intervals",
        };
      };
    }
    try {
      measuring = true;
      const started = performance.now();
      for (let r = 0; r < rounds; r++) all.push(...(await run(shuffled(base, 4004 + r))));
      seconds = (performance.now() - started) / 1000;
      measuring = false;
      await stopSampler();
      if (probe) resourcesAfter = await snapshot(probe);
    } finally {
      measuring = false;
      if (probe) await probe.end().catch(() => undefined);
    }
  } finally {
    await closeAll(clients);
  }
  syntheticHits = all.filter((t) => (t.synthetic ?? 0) > 0).length;

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
    queries: synthetic !== null ? base.length / 6 : entries.length,
    concurrency,
    pooler: pooler ?? "direct",
    rounds,
    searches: all.length,
    throughput_per_s: Math.round(all.length / seconds),
    // what was really measured: with --one-trip the time inside the database, and how many searches were in flight
    timing: oneTrip
      ? "database (clock_timestamp around the search), one round trip per search"
      : "client",
    synthetic,
    clients: concurrency,
    ...(oneTrip
      ? {
          client: stats(all.map((t) => ({ ...t, ms: t.clientMs ?? t.ms }))),
          // measured in PostgreSQL (perf-accept.ts measuredFields): the fields the acceptance judges
          ...measuredFields(intervals, target, syntheticHits, sampler),
          resources: resourcesDelta(resourcesBefore, resourcesAfter),
        }
      : {}),
    overall: stats(all),
    by_bucket: Object.fromEntries(
      buckets.map((b) => [b, stats(all.filter((t) => t.bucket === b))]),
    ),
  };
  console.log(JSON.stringify(report, null, 2));
  if (typeof args.out === "string") writeFileSync(args.out, JSON.stringify(report, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
