/**
 * The concurrency ladder (docs/sprints/ratings/PERF-LADDER.md): catalogue search at 1, 2, 4, 8 and 16 concurrent
 * searches, READ-ONLY, measured inside PostgreSQL, for the proposed release gate. perf16 (perf.ts, perf-accept.ts)
 * stays the growth target, unchanged.
 *
 *   tsx ladder.ts run --db <url> [--staging-project <ref>] --set ../../eval/catalog/benchmark.json --out-dir <dir>
 *     [--levels 1,2,4,8,16] [--searches 1000,2000,4000,4000,4000] [--warmup 150] [--batch 1] [--path pilot|public]
 *     [--provider xwines] [--records 40000] [--seed 2026] [--timeout-ms 15000] [--pooler auto|transaction]
 *     [--gate-p95 250 --gate-level 4 --gate-report 8]
 *     writes ladder-c<N>.json per level and ladder-summary.json; exit 1 when the MEASUREMENT is not valid (a search
 *     failed, the concurrency was not reached, too few searches), never because of the proposed gate
 *   tsx ladder.ts judge --summary ladder-summary.json [--gate-p95 250 --gate-level 4 --gate-report 8]
 *     the same verdict from a summary: the measurement checks (exit 1 on any failure) and the gate (reported only)
 *
 * How (each part reused from perf.ts --one-trip and perf-accept.ts):
 * - Per level N exactly N clients, in a CLOSED loop: each client sends its next message when the previous one has
 *   returned, no think time. The searches of a level are dealt out equally over the clients before it starts.
 * - One message = one READ-ONLY transaction (`begin transaction read only`, the role and a statement timeout set
 *   locally, as PostgREST does per request) with `--batch` searches, each between two readings of the server's
 *   clock (clock_timestamp) with its backend's pid. Batch 1 is one search per round trip. A batch of more keeps the
 *   backend busy across the runner's round trip: from GitHub's runner to the staging region the round trip (about
 *   150 ms, staging run 46166107062) is three times a search (about 48 ms), so with one search per message N clients
 *   keep only about N/4 searches executing and the level would be judged at a quarter of its concurrency. Batched,
 *   N clients keep about N executing; that is measured, not assumed.
 * - Concurrency is MEASURED: the overlap of the searches' server-side intervals (perf-accept.ts concurrencyOf,
 *   overlapOf): peak, median, time-weighted mean, steady-state share at N, distinct backends. A sampler reads
 *   pg_stat_activity on its own session connection (a cross-check; a whole message counts as active there), and
 *   pg_stat_statements and pg_stat_database are read before and after each level (perf.ts snapshot).
 * - Client-side time per search = its SQL time plus its message's overhead (the message's round trip at the client
 *   minus the SQL time of its searches: network, pooler, begin, role, commit). Exactly the client's round trip when
 *   the batch is 1; with a batch, the time one search would take as its own request.
 * - Paths: `pilot` (default) public.catalog_search_pilot as the service role (pilot and staging databases only),
 *   the same private.catalog_search_impl as people's search over the scopes pilot + public; `public` the people's
 *   public.catalog_search with each household's member's claims (membership check, scope public only).
 * - The query stream (ladder-lib.ts buildMix): real records of `--provider` and the benchmark's wines, read
 *   read-only and kept in memory only. Reports carry counts and timings only: no query text, no record, no
 *   household id; a failure is reported by its SQLSTATE, never by its message (which can quote the query).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import { isLocalHost, parseArgs, str, type Args } from "./lib";
import {
  autoBatch,
  buildMix,
  GATE_PROPOSAL,
  HOT_SHARE,
  HOT_SIZE,
  judgeGate,
  levelReport,
  measurementChecks,
  messageSql,
  MIX,
  parseMessage,
  summaryLine,
  type Check,
  type Gate,
  type LevelReport,
  type MessageItem,
  type Sample,
  type Sampler,
  type Search,
  type Source,
  type SummaryLine,
} from "./ladder-lib";
import { resourcesDelta, snapshot } from "./perf";
import { closeAll, openClients, poolerOf, transactionPoolerUrl } from "./pool";
import { connectToTarget, connectToTargetForTransactions } from "./target";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function numbers(v: string, what: string): number[] {
  const out = v.split(",").map((x) => Number(x.trim()));
  if (out.length === 0 || out.some((x) => !Number.isInteger(x) || x < 1))
    throw new Error(`${what}: a comma-separated list of whole numbers of at least 1`);
  return out;
}

export function gateOf(args: Args): Gate {
  const g: Gate = {
    p95_ms: Number(str(args, "gate-p95", String(GATE_PROPOSAL.p95_ms))),
    level: Number(str(args, "gate-level", String(GATE_PROPOSAL.level))),
    report: numbers(str(args, "gate-report", GATE_PROPOSAL.report.join(",")), "--gate-report"),
  };
  if (!Number.isFinite(g.p95_ms) || g.p95_ms <= 0 || !Number.isInteger(g.level) || g.level < 1)
    throw new Error("--gate-p95 and --gate-level must be positive numbers");
  return g;
}

/** One read-only transaction, one round trip: its result sets. */
async function readOnly(c: Client, statements: string[]) {
  const text = [
    "begin transaction read only",
    "set local role service_role",
    "select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)",
    ...statements,
    "commit",
  ].join("; ");
  try {
    const res = (await c.query(text)) as unknown as Array<{ rows: Array<Record<string, unknown>> }>;
    return res.slice(3, 3 + statements.length);
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  }
}

async function run(args: Args) {
  const db = str(args, "db");
  const outDir = str(args, "out-dir");
  const levels = numbers(str(args, "levels", "1,2,4,8,16"), "--levels");
  const defaults: Record<number, number> = { 1: 1000, 2: 2000 };
  const searches =
    typeof args.searches === "string"
      ? numbers(args.searches, "--searches")
      : levels.map((l) => defaults[l] ?? 4000);
  if (searches.length !== levels.length) throw new Error("--searches needs one number per level");
  const warmup = Number(str(args, "warmup", "150"));
  const batchArg = str(args, "batch", "auto");
  if (batchArg !== "auto" && !(Number.isInteger(Number(batchArg)) && Number(batchArg) >= 1))
    throw new Error("--batch auto|<searches per message>");
  if (batchArg === "auto" && warmup < 10)
    throw new Error("--batch auto needs a warm-up of at least 10");
  const timeoutMs = Number(str(args, "timeout-ms", "15000"));
  const records = Number(str(args, "records", "40000"));
  const seed = Number(str(args, "seed", "2026"));
  const provider = str(args, "provider", "xwines");
  const path = str(args, "path", "pilot");
  if (path !== "pilot" && path !== "public") throw new Error("--path pilot|public");
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(provider)) throw new Error("--provider <provider id>");
  for (const [k, v] of Object.entries({ warmup, records, seed }))
    if (!Number.isInteger(v) || v < (k === "warmup" || k === "seed" ? 0 : 1))
      throw new Error(`--${k} must be a whole number`);
  const gate = gateOf(args);
  const poolerArg = str(args, "pooler", "auto");
  if (poolerArg !== "auto" && poolerArg !== "transaction")
    throw new Error("--pooler auto|transaction (the ladder runs one transaction per message)");
  // a local database has no pooler: the same one-transaction-per-message path runs against it directly
  const local = isLocalHost(new URL(db).hostname);
  const url = local || poolerOf(db) === "transaction" ? db : transactionPoolerUrl(db);
  const fn = path === "pilot" ? "public.catalog_search_pilot" : "public.catalog_search";
  const maxLevel = Math.max(...levels);

  // every connection is checked against the allowed targets and the database's own identity; all closed whatever
  // happens
  const clients = await openClients(maxLevel, () => connectToTargetForTransactions(url, args));
  let probe: Client | null = null;
  const reports: LevelReport[] = [];
  try {
    // the inputs, read-only: the households (and, for the people's path, a member of each), the provider's records
    const [hh, recs, members] = await readOnly(clients[0]!, [
      "select id::text as id from public.households order by id",
      `select producer, name, wine_type::text as type, country_code as country from public.catalog_external_records
        where provider_id = ${clients[0]!.escapeLiteral(provider)} and status = 'active'
        order by md5(id::text || ${seed}::text) limit ${records}`,
      "select household_id::text as h, min(user_id::text) as u from public.household_members group by 1",
    ]);
    const memberOf = new Map((members?.rows ?? []).map((r) => [String(r.h), String(r.u)]));
    const households = (hh?.rows ?? [])
      .map((r) => String(r.id))
      .filter((id) => UUID.test(id) && (path === "pilot" || memberOf.has(id)));
    if (households.length === 0) throw new Error("no household to search for");
    const sources = (recs?.rows ?? []) as unknown as Source[];
    if (sources.length < 1000)
      throw new Error(`only ${sources.length} active records of ${provider}`);
    const benchmark = (
      JSON.parse(readFileSync(str(args, "set"), "utf8")) as {
        entries: Array<{
          query: string;
          expect?: { producer: string; wine: string; type: string; country: string };
        }>;
      }
    ).entries
      .filter((e) => e.expect !== undefined)
      .map((e): Source => ({
        producer: e.expect!.producer,
        name: e.expect!.wine,
        type: e.expect!.type,
        country: e.expect!.country,
        query: e.query,
      }));
    const mix = buildMix({
      records: sources,
      benchmark,
      households: households.length,
      levels: levels.map((level, i) => ({ level, searches: searches[i]!, warmup })),
      seed,
    });
    const item = (s: Search): MessageItem => {
      const household = households[s.household]!;
      return {
        q: s.q,
        type: s.type,
        country: s.country,
        household,
        ...(path === "public" ? { user: memberOf.get(household)! } : {}),
      };
    };

    // the sampler and the resource snapshots: one SESSION connection, as the login role (pg_read_all_stats)
    probe = await connectToTarget(db, args);
    await probe.query("reset role");

    for (const level of levels) {
      const plan = mix.levels.get(level)!;
      const lanes = clients.slice(0, level);
      // the searches cut into messages, in order; each client takes the next message when its previous one has
      // returned (a shared queue, so no client idles while another still has work: the level ends together)
      const deal = (list: Search[], size: number) => {
        const msgs: Search[][] = [];
        for (let i = 0; i < list.length; i += size) msgs.push(list.slice(i, i + size));
        return msgs;
      };
      type Sink = { samples: Sample[]; overheads: number[] };
      const loop = async (queue: Search[][], sink: Sink) => {
        let next = 0;
        await Promise.all(
          lanes.map(async (c) => {
            while (next < queue.length) {
              const msg = queue[next++]!;
              const text = messageSql(msg.map(item), {
                path,
                timeoutMs,
                escape: (s) => c.escapeLiteral(s),
              });
              const t0 = performance.now();
              try {
                const res = (await c.query(text)) as unknown as Array<{
                  rows: Array<Record<string, unknown>>;
                }>;
                const clientMs = performance.now() - t0;
                const got = parseMessage(res);
                if (got.length !== msg.length)
                  throw Object.assign(new Error("short"), { code: "short-result" });
                const overhead = clientMs - got.reduce((a, g) => a + (g.end - g.start), 0);
                sink.overheads.push(overhead);
                got.forEach((g, i) =>
                  sink.samples.push({
                    kind: msg[i]!.kind,
                    repeat: msg[i]!.repeat,
                    ok: true,
                    start: g.start,
                    end: g.end,
                    pid: g.pid,
                    rows: g.rows,
                    clientMs: g.end - g.start + overhead,
                  }),
                );
              } catch (e) {
                await c.query("rollback").catch(() => undefined);
                // fail-closed: every search of a failed message is an error; only the SQLSTATE is kept
                const code = String((e as { code?: unknown }).code ?? "client");
                for (const s of msg)
                  sink.samples.push({ kind: s.kind, repeat: s.repeat, ok: false, code });
              }
            }
          }),
        );
      };
      // the warm-up (not counted), in messages of 10 (or the fixed batch); with --batch auto it sets this level's
      // batch from what it measured: the round trip overhead and the SQL time at this level
      const warm: Sink = { samples: [], overheads: [] };
      await loop(
        deal(
          plan.warmup,
          batchArg === "auto"
            ? Math.max(1, Math.min(10, Math.floor(plan.warmup.length / level)))
            : Number(batchArg),
        ),
        warm,
      );
      const warmFailed = warm.samples.filter((s) => !s.ok).length;
      const batch =
        batchArg === "auto"
          ? autoBatch(
              warm.overheads,
              warm.samples.filter((s) => s.ok).map((s) => s.end! - s.start!),
              0.02,
              // at least 8 messages per client, so the level's end (the last messages) stays short
              Math.max(1, Math.min(200, Math.floor(plan.measured.length / (8 * level)))),
            )
          : Number(batchArg);
      const samples: Sample[] = [];
      const overheads: number[] = [];
      // the sampler: active searches (this path) and anything else active, every 50 ms
      const before = await snapshot(probe, `%${fn}(%`);
      const active: number[] = [];
      const others: number[] = [];
      let on = true;
      const p = probe;
      const sampling = (async () => {
        while (on) {
          const r = await p.query<{ n: number; o: number }>(
            `select count(*) filter (where query like '%' || $1 || '(%')::int as n,
                    count(*) filter (where query not like '%' || $1 || '(%')::int as o
               from pg_stat_activity
              where state = 'active' and backend_type = 'client backend' and pid <> pg_backend_pid()`,
            [fn],
          );
          active.push(r.rows[0]!.n);
          others.push(r.rows[0]!.o);
          await new Promise((ok) => setTimeout(ok, 50));
        }
      })();
      const cpu0 = process.cpuUsage();
      const started = performance.now();
      try {
        await loop(deal(plan.measured, batch), { samples, overheads });
      } finally {
        on = false;
        await sampling;
      }
      const seconds = (performance.now() - started) / 1000;
      const cpu = process.cpuUsage(cpu0);
      // a backend flushes its pg_stat_database counters at most once a second (PostgreSQL 15+): wait for them
      await new Promise((ok) => setTimeout(ok, 1500));
      const after = await snapshot(probe, `%${fn}(%`);
      const mean = (xs: number[]) =>
        xs.length ? Math.round((xs.reduce((a, x) => a + x, 0) / xs.length) * 10) / 10 : 0;
      const sorted = [...active].sort((a, b) => a - b);
      const sampler: Sampler = {
        samples: active.length,
        max_active: Math.max(0, ...active),
        mean_active: mean(active),
        median_active: sorted[Math.floor(sorted.length / 2)] ?? 0,
        mean_other_active: mean(others),
        max_other_active: Math.max(0, ...others),
        note: "a whole message counts as active (an upper bound, a cross-check of the intervals); other = any other active client backend",
      };
      const report = levelReport({
        level,
        clients: lanes.length,
        batch,
        seconds,
        warmup: plan.warmup.length,
        warmupErrors: warmFailed,
        samples,
        overheads,
        sampler,
        resources: resourcesDelta(before, after),
        householdsUsed: new Set(plan.measured.map((s) => s.household)).size,
        clientCpuMs: (cpu.user + cpu.system) / 1000,
      });
      reports.push(report);
      writeFileSync(
        join(outDir, `ladder-c${level}.json`),
        JSON.stringify({ ...header(), ...report }, null, 2) + "\n",
      );
      console.log(
        `c${level}: sql p50 ${report.sql.p50} p95 ${report.sql.p95} p99 ${report.sql.p99} ms; client p95 ${report.client.p95} ms; ` +
          `${report.throughput_per_s}/s; errors ${report.errors.count}; in PostgreSQL mean ${report.database_concurrency.mean} peak ${report.database_concurrency.peak}`,
      );
    }
  } finally {
    if (probe) await probe.end().catch(() => undefined);
    await closeAll(clients);
  }

  function header() {
    return {
      tool: "ladder.ts",
      target: local ? "local" : "staging",
      path: fn,
      scopes: path === "pilot" ? "pilot + public" : "public",
      read_only: "every search in a read-only transaction (begin transaction read only)",
      pooler: local ? "direct (one transaction per message)" : "transaction",
      timing:
        "sql: the server's clock around each search (clock_timestamp); client: sql plus its message's round-trip overhead at the runner",
      loop: "closed: exactly N clients, each sends its next message (one read-only transaction of `batch` searches) when the previous returns, no think time",
      batch_rule:
        batchArg === "auto"
          ? "auto: per level from its warm-up, enough searches per message that the round trip leaves each backend idle at most 2% of the time (1 to 200, and at most searches / (8 × N) so each client sends at least 8)"
          : `fixed: ${batchArg}`,
    };
  }
  const summary = {
    ...header(),
    provider,
    mix: {
      kinds: MIX,
      hot_share: HOT_SHARE,
      hot_size: HOT_SIZE,
      unique: "never repeated in the run",
      seed,
    },
    levels: reports.map(summaryLine),
    ...verdict(reports.map(summaryLine), gate),
  };
  writeFileSync(join(outDir, "ladder-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  print(summary.measurement.checks, summary.gate_proposal);
  if (!summary.measurement.ok) process.exitCode = 1;
}

/** The measurement checks of every level and the proposed gate. */
export function verdict(levels: readonly SummaryLine[], gate: Gate) {
  const checks: Check[] = levels.flatMap((l) => measurementChecks(l));
  if (levels.length === 0) checks.push({ name: "levels measured", ok: false, detail: "none" });
  return {
    measurement: { ok: checks.every((c) => c.ok), checks },
    gate_proposal: judgeGate(levels, gate),
  };
}

function print(checks: Check[], gate: ReturnType<typeof judgeGate>) {
  for (const c of checks) console.log(`${c.ok ? "  ok  " : "  FAIL"} ${c.name}: ${c.detail}`);
  console.log(`ladder measurement: ${checks.every((c) => c.ok) ? "VALID" : "NOT VALID"}`);
  console.log(`${gate.rule}: ${gate.verdict.toUpperCase()} (${gate.detail}) [${gate.status}]`);
  for (const r of gate.reported)
    console.log(
      `  reported: at ${r.level} concurrent SQL p95 ${r.sql_p95 ?? "?"} ms${r.under_threshold === null ? "" : r.under_threshold ? " (under the threshold)" : " (over the threshold)"}${!r.measured ? " (not measured)" : r.valid ? "" : " (measurement not valid)"}`,
    );
}

function judge(args: Args) {
  const s = JSON.parse(readFileSync(str(args, "summary"), "utf8")) as { levels?: SummaryLine[] };
  // recomputed from the levels' numbers, never taken from the file's own verdict
  const v = verdict(s.levels ?? [], gateOf(args));
  print(v.measurement.checks, v.gate_proposal);
  if (!v.measurement.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  (cmd === "run"
    ? run(args)
    : cmd === "judge"
      ? Promise.resolve(judge(args))
      : Promise.reject(new Error("ladder.ts run|judge"))
  ).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
