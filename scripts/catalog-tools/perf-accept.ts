/**
 * perf16's measurement and its acceptance (docs/sprints/sprint-004c/GO_LIVE.md A3): people's search at 16 concurrent
 * searches over a populated public source, database p95 under 250 ms. FAIL-CLOSED: anything not shown is a failure.
 *
 * How concurrency is measured (not from the number of clients, nor from throughput × client latency): every search
 * records, with the DATABASE SERVER's clock, when its search statement started and ended and on which backend
 * (`clock_timestamp()`, `pg_backend_pid()`, perf.ts --one-trip). All backends of one server share that clock, so the
 * overlap of those intervals is exactly how many searches PostgreSQL was executing at each moment. Reported: the
 * peak, the time-weighted mean, the median over time, and the share of the measured window in which at least the
 * target number were executing, plus the number of distinct backends. A sampler on its own connection reads
 * pg_stat_activity during the run as an independent cross-check (perf.ts --sample-activity).
 *
 *   tsx perf-accept.ts --report perf-public-synthetic-c16.json [--target 16] [--p95 250] [--out accept.json]
 *     exit 1 when any acceptance check fails
 *   tsx perf-accept.ts cleanup --before perf-state-before.json --after perf-state-after.json
 *     exit 1 unless the synthetic source is off and found by no one, X-Wines stayed pilot, and nothing else changed
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs, percentile, str } from "./lib";

export type Check = { name: string; ok: boolean; detail: string };
export interface Interval {
  start: number;
  end: number;
}

export interface Concurrency {
  window_ms: number;
  peak: number;
  /** Time-weighted mean of the number executing, over the window from the first start to the last end. */
  mean: number;
  /** The number executing at the median moment of the window. */
  median: number;
  /** Share of the window in which at least `target` were executing. */
  share_at_target: number;
  /** The same share in the steady state: the window without its first and last 10% (ramp-up and ramp-down). */
  steady_share_at_target: number;
  target: number;
}

/** Piecewise-constant concurrency: [t0, t1) with `level` executing. */
type Span = { t0: number; t1: number; level: number };

function spansOf(intervals: readonly Interval[]): Span[] {
  const events = intervals
    .flatMap((i) => [
      { t: i.start, d: 1 },
      { t: i.end, d: -1 },
    ])
    // ends before starts at the same instant: touching intervals do not overlap
    .sort((a, b) => a.t - b.t || a.d - b.d);
  const spans: Span[] = [];
  let level = 0;
  for (let k = 0; k < events.length; k++) {
    level += events[k]!.d;
    const next = events[k + 1]?.t ?? events[k]!.t;
    if (next > events[k]!.t) spans.push({ t0: events[k]!.t, t1: next, level });
  }
  return spans;
}

const valid = (i: Interval) =>
  Number.isFinite(i.start) && Number.isFinite(i.end) && i.end >= i.start;

/**
 * For each interval, how many searches (itself included) were executing on average DURING it: the concurrency each
 * search actually ran at. NaN for an invalid interval. Pure.
 */
export function overlapOf(intervals: readonly Interval[]): number[] {
  const spans = spansOf(intervals.filter(valid));
  return intervals.map((i) => {
    if (!valid(i)) return NaN;
    // first span that ends after the start
    let lo = 0;
    let hi = spans.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (spans[m]!.t1 <= i.start) lo = m + 1;
      else hi = m;
    }
    if (i.end === i.start) return spans[lo]?.level ?? 1;
    let sum = 0;
    for (let k = lo; k < spans.length && spans[k]!.t0 < i.end; k++) {
      const s = spans[k]!;
      sum += s.level * (Math.min(s.t1, i.end) - Math.max(s.t0, i.start));
    }
    return sum / (i.end - i.start);
  });
}

/** The concurrency of server-side intervals (milliseconds on one clock). Pure. */
export function concurrencyOf(intervals: readonly Interval[], target: number): Concurrency {
  const ok = intervals.filter(valid);
  if (ok.length === 0)
    return {
      window_ms: 0,
      peak: 0,
      mean: 0,
      median: 0,
      share_at_target: 0,
      steady_share_at_target: 0,
      target,
    };
  // ends before starts at the same instant: touching intervals do not overlap
  const events = ok
    .flatMap((i) => [
      { t: i.start, d: 1 },
      { t: i.end, d: -1 },
    ])
    .sort((a, b) => a.t - b.t || a.d - b.d);
  const from = events[0]!.t;
  const to = events[events.length - 1]!.t;
  const window = to - from;
  let level = 0;
  let peak = 0;
  let weighted = 0;
  let atTarget = 0;
  const spans: Array<{ level: number; ms: number }> = [];
  for (let k = 0; k < events.length; k++) {
    level += events[k]!.d;
    peak = Math.max(peak, level);
    const next = events[k + 1]?.t ?? events[k]!.t;
    const ms = next - events[k]!.t;
    if (ms > 0) {
      weighted += level * ms;
      if (level >= target) atTarget += ms;
      spans.push({ level, ms });
    }
  }
  // the steady state: the window without its first and last 10%
  const lo = from + window * 0.1;
  const hi = to - window * 0.1;
  let steadyAt = 0;
  for (const sp of spansOf(ok))
    if (sp.level >= target) steadyAt += Math.max(0, Math.min(sp.t1, hi) - Math.max(sp.t0, lo));
  let median = 0;
  if (window > 0) {
    let acc = 0;
    for (const s of [...spans].sort((a, b) => a.level - b.level)) {
      acc += s.ms;
      if (acc >= window / 2) {
        median = s.level;
        break;
      }
    }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    window_ms: r2(window),
    peak,
    mean: window > 0 ? r2(weighted / window) : peak,
    median,
    share_at_target: window > 0 ? r2(atTarget / window) : 0,
    steady_share_at_target: hi > lo ? r2(steadyAt / (hi - lo)) : 0,
    target,
  };
}

export type LatencyStats = { n: number; p50: number; p95: number; p99: number };
type Judged = Required<
  Pick<
    PerfReport,
    "synthetic_hits" | "database_concurrency" | "latency_at_target" | "activity_sampler"
  >
>;

/**
 * The fields perf.ts reports for --one-trip, from the measured rounds: the concurrency in PostgreSQL, each search's
 * latency at the concurrency it ran at (p95 is judged at the target), the synthetic answers and the sampler. Typed
 * against what judgePerf reads, so the two cannot drift apart. Pure.
 */
export function measuredFields(
  intervals: ReadonlyArray<Interval & { pid: number }>,
  target: number,
  syntheticHits: number,
  sampler: NonNullable<PerfReport["activity_sampler"]> | null,
): Judged & { latency_by_band: Record<string, LatencyStats> } {
  const ov = overlapOf(intervals);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const st = (keep: (o: number) => boolean): LatencyStats => {
    const ms = intervals
      .filter((_, k) => keep(ov[k]!))
      .map((i) => i.end - i.start)
      .sort((a, b) => a - b);
    return {
      n: ms.length,
      p50: r1(percentile(ms, 50)),
      p95: r1(percentile(ms, 95)),
      p99: r1(percentile(ms, 99)),
    };
  };
  return {
    synthetic_hits: syntheticHits,
    database_concurrency: {
      ...concurrencyOf(intervals, target),
      backends: new Set(intervals.map((i) => i.pid)).size,
    },
    latency_at_target: st((o) => o >= target),
    latency_by_band: {
      [`below ${target}`]: st((o) => o < target),
      [`${target} to ${target + 3}`]: st((o) => o >= target && o < target + 4),
      [`${target + 4} or more`]: st((o) => o >= target + 4),
    },
    activity_sampler: sampler,
  };
}

/** The acceptance criteria. Changing one is a reviewed decision (GO_LIVE.md A3). */
export const ACCEPT = {
  p95_ms: 250,
  target: 16,
  /** At least this share of the steady-state window must have `target` searches executing in PostgreSQL. */
  min_steady_share_at_target: 0.8,
  /** No more than this share of searches may return nothing. */
  max_empty_share: 0.2,
  /** At least this share of searches must return a record of the synthetic public source. */
  min_synthetic_share: 0.7,
  /** A run below this many measured searches proves nothing. */
  min_searches: 500,
};

/** What perf.ts writes (the parts judged here). */
export interface PerfReport {
  mode?: string;
  synthetic?: string | null;
  timing?: string;
  searches?: number;
  overall?: { n?: number; p50?: number; p95?: number; p99?: number; empty?: number };
  /** Database time of the searches that themselves ran with at least `target` executing (overlapOf). */
  latency_at_target?: { n?: number; p50?: number; p95?: number; p99?: number };
  synthetic_hits?: number;
  database_concurrency?: Concurrency & { backends?: number };
  activity_sampler?: { samples: number; max_active: number; mean_active: number } | null;
}

/** The acceptance checks for a perf16 report. Pure; every missing value fails. */
export function judgePerf(r: PerfReport, a: typeof ACCEPT = ACCEPT): Check[] {
  const c: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => c.push({ name, ok, detail });
  const n = r.overall?.n ?? 0;
  const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  add(
    "measured: people's search, timed inside the database",
    r.mode === "public" && typeof r.timing === "string" && r.timing.startsWith("database"),
    `mode ${r.mode ?? "?"}, timing ${r.timing ?? "?"}`,
  );
  add(
    `measured: at least ${a.min_searches} searches`,
    n >= a.min_searches && r.searches === n,
    `${n} searches`,
  );
  const lt = r.latency_at_target;
  const p95 = lt?.p95;
  const nAt = lt?.n ?? 0;
  add(
    `latency: database p95 under ${a.p95_ms} ms, over the searches that ran with ${a.target} or more executing`,
    fin(p95) && nAt >= a.min_searches && p95 < a.p95_ms,
    `${nAt} such searches: p50 ${lt?.p50 ?? "?"} ms, p95 ${p95 ?? "?"} ms, p99 ${lt?.p99 ?? "?"} ms` +
      ` (all searches: p95 ${r.overall?.p95 ?? "?"} ms)`,
  );
  const dc = r.database_concurrency;
  add(
    `concurrency: ${a.target} searches executing in PostgreSQL at once, for at least ${a.min_steady_share_at_target * 100}% of the steady state`,
    !!dc &&
      dc.target === a.target &&
      dc.peak >= a.target &&
      fin(dc.steady_share_at_target) &&
      dc.steady_share_at_target >= a.min_steady_share_at_target,
    dc
      ? `peak ${dc.peak}, median ${dc.median}, mean ${dc.mean}, at ≥${dc.target}: ${Math.round((dc.steady_share_at_target ?? NaN) * 100)}% of the steady state (${Math.round(dc.share_at_target * 100)}% of all ${Math.round(dc.window_ms)} ms)`
      : "not measured",
  );
  // a sanity guard only (pids over the whole run say nothing about simultaneity; the peak and the share do)
  add(
    `concurrency: on at least ${a.target} distinct backends`,
    !!dc && fin(dc.backends) && dc.backends >= a.target,
    dc ? `${dc.backends ?? "?"} backends` : "not measured",
  );
  const s = r.activity_sampler;
  add(
    `concurrency: pg_stat_activity saw ${a.target} active searches`,
    !!s && s.samples > 0 && s.max_active >= a.target,
    s ? `max ${s.max_active}, mean ${s.mean_active} over ${s.samples} samples` : "no sampler",
  );
  const empty = r.overall?.empty;
  add(
    `results: at most ${a.max_empty_share * 100}% of searches empty`,
    fin(empty) && n > 0 && empty / n <= a.max_empty_share,
    fin(empty) && n > 0 ? `${empty} empty (${Math.round((empty / n) * 100)}%)` : "not measured",
  );
  add(
    `results: the synthetic public source answers at least ${a.min_synthetic_share * 100}% of searches`,
    typeof r.synthetic === "string" &&
      fin(r.synthetic_hits) &&
      n > 0 &&
      r.synthetic_hits / n >= a.min_synthetic_share,
    fin(r.synthetic_hits) && n > 0
      ? `${r.synthetic_hits} of ${n} (${Math.round((r.synthetic_hits / n) * 100)}%) from ${r.synthetic}`
      : "not measured",
  );
  return c;
}

/** perf16-state.sql's answer. */
export interface Perf16State {
  xwines_scope: string | null;
  synth_scope: string | null;
  synth_records?: number;
  person_sees_synth: number;
  users: number;
  households: number;
  wines: number;
}

/**
 * After perf16 (or perf16-cleanup): is the synthetic source off, by its scope AND by what a person's search finds; is
 * X-Wines still pilot; were no person, household or wine touched (equal counts before and after)? Pure.
 */
export function judgeCleanup(before: Perf16State, after: Perf16State): Check[] {
  const c: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => c.push({ name, ok, detail });
  add(
    "cleanup: the synthetic source is off",
    after.synth_scope === null || after.synth_scope === "off",
    `scope ${after.synth_scope ?? "absent"}`,
  );
  add(
    "cleanup: a person's search finds no synthetic record",
    after.person_sees_synth === 0,
    `${after.person_sees_synth} found`,
  );
  add(
    "cleanup: X-Wines stayed pilot",
    before.xwines_scope === "pilot" && after.xwines_scope === "pilot",
    `before ${before.xwines_scope}, after ${after.xwines_scope}`,
  );
  for (const k of ["users", "households", "wines"] as const)
    add(
      `cleanup: no ${k.slice(0, -1)} touched`,
      Number.isInteger(after[k]) && after[k] === before[k],
      `${before[k]} before, ${after[k]} after`,
    );
  return c;
}

function cleanupMain(args: ReturnType<typeof parseArgs>) {
  const read = (k: string) => JSON.parse(readFileSync(str(args, k), "utf8")) as Perf16State;
  const checks = judgeCleanup(read("before"), read("after"));
  const ok = checks.every((x) => x.ok);
  for (const x of checks) console.log(`${x.ok ? "  ok  " : "  FAIL"} ${x.name}: ${x.detail}`);
  console.log(`perf16 cleanup: ${ok ? "CLEAN" : "NOT CLEAN"}`);
  if (!ok) process.exitCode = 1;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "cleanup") return cleanupMain(parseArgs(argv.slice(1)));
  const args = parseArgs(argv);
  const report = JSON.parse(readFileSync(str(args, "report"), "utf8")) as PerfReport;
  const target = Number(str(args, "target", String(ACCEPT.target)));
  const p95 = Number(str(args, "p95", String(ACCEPT.p95_ms)));
  if (!Number.isInteger(target) || target < 1 || !Number.isFinite(p95) || p95 <= 0)
    throw new Error("--target and --p95 must be positive numbers");
  const checks = judgePerf(report, { ...ACCEPT, target, p95_ms: p95 });
  const ok = checks.every((x) => x.ok);
  for (const x of checks) console.log(`${x.ok ? "  ok  " : "  FAIL"} ${x.name}: ${x.detail}`);
  console.log(`perf16 acceptance: ${ok ? "MET" : "NOT MET"}`);
  if (typeof args.out === "string")
    writeFileSync(
      args.out,
      JSON.stringify({ ok, accept: { ...ACCEPT, target, p95_ms: p95 }, checks }, null, 2) + "\n",
    );
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
