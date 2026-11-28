/**
 * The concurrency ladder (perf-ladder, docs/sprints/ratings/PERF-LADDER.md): the pure parts of ladder.ts, tested on
 * their own. Nothing here opens a connection.
 *
 * - buildMix: the query stream, a documented mix of what a debounced autocomplete sends (prefixes while typing,
 *   whole names, producer only, typos, filters), 30% from a small hot set reused across households and 70% fully
 *   unique queries that never repeat anywhere in the run; every search is for one of many households.
 * - levelReport: one level's measurement (SQL and client latency, throughput, errors, the concurrency PostgreSQL
 *   actually executed, resources, per bucket). Only counts and timings: no query text, no record, no household id.
 * - measurementChecks / judgeMeasurement: is the measurement valid (no error, the concurrency reached, enough
 *   searches)? This, and only this, decides the run's exit code.
 * - judgeGate: the PROPOSED release gate (SQL p95 under 250 ms at 4 concurrent, 8 reported). Reported, never
 *   enforced: the owner has not approved it yet. Its thresholds are parameters.
 */
import { percentile, shuffled } from "./lib";
import { concurrencyOf, overlapOf, type Concurrency, type Interval } from "./perf-accept";

/** What one search is, by what a person typed. */
export type Kind = "prefix-3" | "prefix-5" | "prefix-8" | "full" | "producer" | "typo" | "filtered";
export const KINDS: readonly Kind[] = [
  "prefix-3",
  "prefix-5",
  "prefix-8",
  "full",
  "producer",
  "typo",
  "filtered",
];

/**
 * The mix (shares of the measured stream, summing to 1). Why: with a 250 ms debounce a person typing a wine at a
 * normal pace sends a few intermediate prefixes and then the whole query, so prefixes are the largest part (45%,
 * the 3-character prefix being the widest candidate set); a whole "producer wine" name is the most common finished
 * query (20%); producer only (10%), typos (10%) and a filter on type and/or country (10%) are the rest.
 */
export const MIX: Readonly<Record<Kind, number>> = {
  "prefix-3": 0.15,
  "prefix-5": 0.15,
  "prefix-8": 0.15,
  full: 0.2,
  producer: 0.1,
  typo: 0.1,
  filtered: 0.1,
};
/** 30% of the stream repeats a hot set of 30 queries (popular wines, typed by many households). */
export const HOT_SHARE = 0.3;
export const HOT_SIZE = 30;

/** A wine to build queries from: a real record of the provider, or a benchmark entry. Never written anywhere. */
export interface Source {
  producer: string;
  name: string;
  type: string | null;
  country: string | null;
  /** What people type for this wine, when known (a benchmark entry's query); else "producer name". */
  query?: string;
}

export interface Search {
  q: string;
  type: string | null;
  country: string | null;
  kind: Kind;
  repeat: "hot" | "unique";
  /** An index into the household list (the id itself never leaves ladder.ts). */
  household: number;
}

/** Text as a person types it: lower case, no accents, no punctuation, single spaces, at most six words. */
export function typed(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .slice(0, 6)
    .join(" ");
}

/** "producer name", without repeating the producer when the name already starts with it. */
export function fullName(s: Source): string {
  if (s.query) return typed(s.query);
  const p = typed(s.producer);
  const n = typed(s.name);
  return typed(n.startsWith(p) ? n : `${p} ${n}`);
}

/** A typo in the middle of the text: two neighbouring letters swapped (even salt) or one letter dropped (odd). */
export function typo(text: string, salt: number): string | null {
  const letters = [...text].map((ch, i) => ({ ch, i })).filter((x) => /\p{L}/u.test(x.ch));
  if (letters.length < 5) return null;
  const mid = Math.floor(letters.length / 2) - (salt % 3);
  const k = letters[Math.max(1, Math.min(letters.length - 2, mid))]!.i;
  const chars = [...text];
  if (salt % 2 === 0) {
    if (!/\p{L}/u.test(chars[k + 1] ?? "") || chars[k] === chars[k + 1]) return null;
    [chars[k], chars[k + 1]] = [chars[k + 1]!, chars[k]!];
  } else chars.splice(k, 1);
  const out = chars.join("");
  return out !== text ? out : null;
}

/** One query of a kind from a source, or null when the source cannot give that kind. */
export function variant(
  s: Source,
  kind: Kind,
  salt: number,
): { q: string; type: string | null; country: string | null } | null {
  const full = fullName(s);
  const plain = (q: string | null) => (q ? { q, type: null, country: null } : null);
  switch (kind) {
    case "prefix-3":
    case "prefix-5":
    case "prefix-8": {
      const n = Number(kind.slice(7));
      return full.length > n ? plain(full.slice(0, n).trim()) : null;
    }
    case "full":
      return plain(full);
    case "producer":
      return plain(typed(s.producer));
    case "typo":
      return plain(typo(full, salt));
    case "filtered": {
      // rotate: type and country, type only, country only (each only when the source has it)
      const which = salt % 3;
      const type = which !== 2 ? s.type : null;
      const country = which !== 1 ? s.country : null;
      if (type === null && country === null) return null;
      return { q: salt % 2 === 0 ? full : typed(s.producer), type, country };
    }
  }
}

/** Whole-number quotas for `n` by `shares` (largest remainder): they sum to exactly `n`. Pure. */
export function quotas<K extends string>(
  n: number,
  shares: Readonly<Record<K, number>>,
): Record<K, number> {
  const keys = Object.keys(shares) as K[];
  const total = keys.reduce((a, k) => a + shares[k], 0);
  const raw = keys.map((k) => ({ k, x: (n * shares[k]) / total }));
  const out = Object.fromEntries(raw.map((r) => [r.k, Math.floor(r.x)])) as Record<K, number>;
  let left = n - raw.reduce((a, r) => a + Math.floor(r.x), 0);
  for (const r of [...raw].sort(
    (a, b) =>
      b.x - Math.floor(b.x) - (a.x - Math.floor(a.x)) || keys.indexOf(a.k) - keys.indexOf(b.k),
  )) {
    if (left <= 0) break;
    out[r.k]++;
    left--;
  }
  return out;
}

const keyOf = (v: { q: string; type: string | null; country: string | null }) =>
  `${v.q}\u0000${v.type ?? ""}\u0000${v.country ?? ""}`;

/** A small deterministic generator (the same as lib.ts shuffled), for the household of each search. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MixInput {
  /** Real records of the provider (read read-only), in a deterministic random order: the unique queries. */
  records: readonly Source[];
  /** Benchmark entries that name a wine: the hot set (popular wines), then more unique queries. */
  benchmark: readonly Source[];
  /** How many households there are to pick from. */
  households: number;
  /** Per level: how many searches are measured and how many warm up first (not counted). */
  levels: ReadonlyArray<{ level: number; searches: number; warmup: number }>;
  seed: number;
  mix?: Readonly<Record<Kind, number>>;
  hotShare?: number;
  hotSize?: number;
}

export interface Mix {
  hot: Search[];
  levels: Map<number, { warmup: Search[]; measured: Search[] }>;
}

/**
 * The query stream of every level. Deterministic in its inputs and seed. Every level's measured searches follow the
 * mix exactly (quotas, not chance), with exactly `hotShare` from the hot set; the unique queries are distinct from
 * each other and from the hot set across the WHOLE run (warm-up included), so no unique query is ever answered
 * twice. Throws when the sources cannot give enough distinct queries of a kind (read more records), never repeats
 * one silently. Pure.
 */
export function buildMix(input: MixInput): Mix {
  const mix = input.mix ?? MIX;
  const hotShare = input.hotShare ?? HOT_SHARE;
  const hotSize = input.hotSize ?? HOT_SIZE;
  if (input.households < 1) throw new Error("no household to search for");
  const used = new Set<string>();
  // the hot set: popular wines (the benchmark's), the same mix of kinds
  const hot: Search[] = [];
  const hotQuota = quotas(hotSize, mix);
  const pool = [...input.benchmark, ...input.records];
  for (const kind of KINDS) {
    // each kind starts at its own place in the pool, so the hot set holds different wines
    const from = KINDS.indexOf(kind) * 5;
    let tried = 0;
    for (let i = 0; i < hotQuota[kind]; i++) {
      for (;;) {
        if (tried >= pool.length) throw new Error(`not enough sources for the hot set (${kind})`);
        const at = (from + tried++) % pool.length;
        const v = variant(pool[at]!, kind, at);
        if (v && !used.has(keyOf(v))) {
          used.add(keyOf(v));
          hot.push({ ...v, kind, repeat: "hot", household: 0 });
          break;
        }
      }
    }
  }
  // unique queries: one cursor per kind over the sources, each key used once in the whole run
  const sources = [...input.benchmark.slice(hotSize), ...input.records];
  const cursors = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
  const nextUnique = (kind: Kind): Search => {
    for (;;) {
      const i = cursors[kind]++;
      if (i >= sources.length)
        throw new Error(
          `the sources ran out of distinct ${kind} queries after ${used.size} queries: read more records (--records)`,
        );
      const v = variant(sources[i]!, kind, i);
      if (v && !used.has(keyOf(v))) {
        used.add(keyOf(v));
        return { ...v, kind, repeat: "unique", household: 0 };
      }
    }
  };
  const levels = new Map<number, { warmup: Search[]; measured: Search[] }>();
  let seed = input.seed;
  const stream = (n: number): Search[] => {
    const nHot = Math.round(n * hotShare);
    const list: Search[] = [];
    // the hot part: the hot set's own kinds, cycled so every hot query is used about equally often
    const hotOrder = shuffled(hot, seed++);
    for (let i = 0; i < nHot; i++) list.push({ ...hotOrder[i % hotOrder.length]! });
    const q = quotas(n - nHot, mix);
    for (const kind of KINDS) for (let i = 0; i < q[kind]; i++) list.push(nextUnique(kind));
    const pick = rng(seed++);
    return shuffled(list, seed++).map((s) => ({
      ...s,
      household: Math.floor(pick() * input.households),
    }));
  };
  for (const l of input.levels) {
    if (!Number.isInteger(l.level) || l.level < 1)
      throw new Error("a level is a number of clients");
    const warmup = stream(l.warmup);
    levels.set(l.level, { warmup, measured: stream(l.searches) });
  }
  return { hot, levels };
}

/**
 * --batch auto: how many searches per message, so that between two messages (the round trip at the client) each
 * backend is idle at most `idle` (2%) of the time: batch × sql ≥ overhead × (1 − idle) / idle. From the warm-up's
 * median overhead per message and mean SQL time per search; 1 to `cap`. Pure.
 */
export function autoBatch(
  overheadsMs: readonly number[],
  sqlMs: readonly number[],
  idle = 0.02,
  cap = 200,
): number {
  const o = [...overheadsMs].filter(Number.isFinite).sort((a, b) => a - b);
  const s = sqlMs.filter(Number.isFinite);
  if (o.length === 0 || s.length === 0) return 1;
  const overhead = Math.max(0, o[Math.floor(o.length / 2)]!);
  const sql = Math.max(0.1, s.reduce((a, x) => a + x, 0) / s.length);
  return Math.max(1, Math.min(cap, Math.ceil((overhead * (1 - idle)) / idle / sql)));
}

// ---- one level's report -----------------------------------------------------------------------------------------

/** One measured search: what kind it was and what happened; never its text or household. */
export interface Sample {
  kind: Kind;
  repeat: "hot" | "unique";
  ok: boolean;
  /** SQLSTATE of the failure (or "client"), never the message (which can quote the query). */
  code?: string;
  /** Server clock, milliseconds: the search statement's start and end (clock_timestamp around it). */
  start?: number;
  end?: number;
  pid?: number;
  /** The client-side time of this search: its SQL time plus its message's round-trip overhead (see ladder.ts). */
  clientMs?: number;
  rows?: number;
}

export interface Stats {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function statsOf(values: readonly number[]): Stats {
  const ms = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return {
    n: ms.length,
    p50: r1(percentile(ms, 50)),
    p95: r1(percentile(ms, 95)),
    p99: r1(percentile(ms, 99)),
    max: r1(ms[ms.length - 1] ?? NaN),
    mean: r1(ms.reduce((a, x) => a + x, 0) / ms.length),
  };
}

export interface Sampler {
  samples: number;
  max_active: number;
  mean_active: number;
  median_active: number;
  /** Active client backends running anything else (another workload on the database would show here). */
  mean_other_active: number;
  max_other_active: number;
  note: string;
}

export interface Resources {
  seconds: number;
  database: Record<string, number | null>;
  search_statements: Record<string, number | null> | null;
}

export interface LevelInput {
  level: number;
  clients: number;
  batch: number;
  seconds: number;
  warmup: number;
  /** Warm-up searches that failed: not measured, but they fail the measurement all the same. */
  warmupErrors: number;
  samples: readonly Sample[];
  /** Per message: the round trip at the client minus the SQL time of its searches (network, pooler, begin/commit). */
  overheads: readonly number[];
  sampler: Sampler | null;
  resources: Resources | null;
  householdsUsed: number;
  clientCpuMs: number | null;
}

export interface LevelReport {
  level: number;
  clients: number;
  batch: number;
  searches: number;
  ok: number;
  warmup: number;
  seconds: number;
  throughput_per_s: number;
  errors: { count: number; rate: number; by_code: Record<string, number>; warmup: number };
  empty: number;
  sql: Stats;
  client: Stats;
  message_overhead: Stats;
  database_concurrency: Concurrency & { backends: number };
  /** SQL latency of the searches that themselves ran with at least `level` executing (overlapOf). */
  sql_at_level: Stats;
  activity_sampler: Sampler | null;
  resources: Resources | null;
  per_search: {
    exec_ms: number | null;
    shared_blocks: number | null;
    cache_hit_percent: number | null;
    temp_blocks: number | null;
  } | null;
  by_bucket: Record<string, Stats & { empty: number }>;
  by_repetition: Record<string, Stats & { empty: number }>;
  households_used: number;
  client_cpu_percent: number | null;
}

/** One level's report from its samples. Only counts and timings. Pure. */
export function levelReport(x: LevelInput): LevelReport {
  const done = x.samples.filter((s) => s.ok);
  const failed = x.samples.filter((s) => !s.ok);
  const intervals: Array<Interval & { pid: number }> = done.map((s) => ({
    start: s.start!,
    end: s.end!,
    pid: s.pid!,
  }));
  const sqlOf = (s: Sample) => s.end! - s.start!;
  const ov = overlapOf(intervals);
  const by_code: Record<string, number> = {};
  for (const f of failed) by_code[f.code ?? "unknown"] = (by_code[f.code ?? "unknown"] ?? 0) + 1;
  const group = (key: (s: Sample) => string) => {
    const out: Record<string, Stats & { empty: number }> = {};
    for (const k of [...new Set(done.map(key))].sort()) {
      const list = done.filter((s) => key(s) === k);
      out[k] = { ...statsOf(list.map(sqlOf)), empty: list.filter((s) => s.rows === 0).length };
    }
    return out;
  };
  const st = x.resources?.search_statements ?? null;
  const calls = st && typeof st.calls === "number" && st.calls > 0 ? st.calls : null;
  const per = (v: number | null | undefined) =>
    calls !== null && typeof v === "number" ? Math.round((v / calls) * 100) / 100 : null;
  return {
    level: x.level,
    clients: x.clients,
    batch: x.batch,
    searches: x.samples.length,
    ok: done.length,
    warmup: x.warmup,
    seconds: r1(x.seconds),
    throughput_per_s: x.seconds > 0 ? r1(done.length / x.seconds) : 0,
    errors: {
      count: failed.length,
      rate:
        x.samples.length > 0 ? Math.round((failed.length / x.samples.length) * 10000) / 10000 : 0,
      by_code,
      warmup: x.warmupErrors,
    },
    empty: done.filter((s) => s.rows === 0).length,
    sql: statsOf(done.map(sqlOf)),
    client: statsOf(done.map((s) => s.clientMs ?? NaN)),
    message_overhead: statsOf(x.overheads),
    database_concurrency: {
      ...concurrencyOf(intervals, x.level),
      backends: new Set(intervals.map((i) => i.pid)).size,
    },
    sql_at_level: statsOf(done.filter((_, k) => ov[k]! >= x.level).map(sqlOf)),
    activity_sampler: x.sampler,
    resources: x.resources,
    per_search: st
      ? {
          exec_ms: per(st.exec_ms),
          shared_blocks: per(
            typeof st.blocks_hit === "number" && typeof st.blocks_read === "number"
              ? st.blocks_hit + st.blocks_read
              : null,
          ),
          cache_hit_percent: typeof st.cache_hit_percent === "number" ? st.cache_hit_percent : null,
          temp_blocks: per(st.temp_blocks_written),
        }
      : null,
    by_bucket: group((s) => s.kind),
    by_repetition: group((s) => s.repeat),
    households_used: x.householdsUsed,
    client_cpu_percent:
      x.clientCpuMs !== null && x.seconds > 0
        ? r1((x.clientCpuMs / (x.seconds * 1000)) * 100)
        : null,
  };
}

// ---- is the measurement valid? (the run's exit code) ------------------------------------------------------------

export type Check = { name: string; ok: boolean; detail: string };

export interface MeasureCriteria {
  /** The fewest measured searches a level needs (by level; the largest level not above it applies). */
  minSearches: Readonly<Record<number, number>>;
  /** The time-weighted mean executing in PostgreSQL must be at least this share of the level. */
  minMeanShare: number;
}

export const MEASURE: MeasureCriteria = {
  minSearches: { 1: 600, 2: 1000, 4: 1500 },
  minMeanShare: 0.85,
};

export function minSearchesFor(level: number, c: MeasureCriteria = MEASURE): number {
  const keys = Object.keys(c.minSearches)
    .map(Number)
    .filter((k) => k <= level)
    .sort((a, b) => b - a);
  return keys.length ? c.minSearches[keys[0]!]! : Math.max(...Object.values(c.minSearches));
}

/** The fields of a level the checks read (a LevelReport, or its line in the summary). */
export type Judged = Pick<
  LevelReport,
  "level" | "clients" | "searches" | "ok" | "errors" | "database_concurrency"
>;

/** Is this level's measurement valid? Fail-closed: anything missing fails. Pure. */
export function measurementChecks(r: Judged, c: MeasureCriteria = MEASURE): Check[] {
  const out: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => out.push({ name, ok, detail });
  const L = r.level;
  const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  add(`c${L}: exactly ${L} clients`, r.clients === L, `${r.clients} clients`);
  add(
    `c${L}: no search failed (warm-up included)`,
    fin(r.errors?.count) &&
      r.errors.count === 0 &&
      fin(r.errors.warmup) &&
      r.errors.warmup === 0 &&
      r.ok === r.searches,
    `${r.errors?.count ?? "?"} errors of ${r.searches} measured, ${r.errors?.warmup ?? "?"} in the warm-up (${
      Object.entries(r.errors?.by_code ?? {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ") || "none"
    })`,
  );
  const min = minSearchesFor(L, c);
  add(`c${L}: at least ${min} searches measured`, fin(r.ok) && r.ok >= min, `${r.ok} measured`);
  const dc = r.database_concurrency;
  add(
    `c${L}: ${L} executing in PostgreSQL at once (peak ${L}, on ${L} or more backends, mean at least ${Math.round(c.minMeanShare * 100)}% of ${L})`,
    !!dc &&
      dc.peak === L &&
      fin(dc.backends) &&
      dc.backends >= L &&
      fin(dc.mean) &&
      dc.mean >= c.minMeanShare * L,
    dc
      ? `peak ${dc.peak}, median ${dc.median}, mean ${dc.mean}, at ${L}: ${Math.round(dc.steady_share_at_target * 100)}% of the steady state, ${dc.backends} backends`
      : "not measured",
  );
  return out;
}

// ---- the proposed release gate (reported, NOT enforced) --------------------------------------------------------

export interface Gate {
  /** SQL p95 must be under this at `level`. */
  p95_ms: number;
  level: number;
  /** Levels reported against the same threshold (informational: "acceptable at 8"). */
  report: readonly number[];
}

/** The owner's preference (2026-11-28): SQL p95 under 250 ms with at least 4 concurrent searches, acceptable at 8. */
export const GATE_PROPOSAL: Gate = { p95_ms: 250, level: 4, report: [8] };

export interface GateVerdict {
  status: "proposal: reported, not enforced (pending the owner's approval)";
  rule: string;
  verdict: "met" | "not met" | "not measured";
  detail: string;
  reported: Array<{
    level: number;
    sql_p95: number | null;
    under_threshold: boolean | null;
    valid: boolean;
    measured: boolean;
  }>;
}

type GateLevel = Judged & { sql: Pick<Stats, "p95"> };

/**
 * The proposed release gate: SQL p95 under `p95_ms` at `level` concurrent searches, the other levels reported. A
 * level whose measurement is not valid counts as not measured. Never decides the exit code. Pure.
 */
export function judgeGate(
  levels: readonly GateLevel[],
  g: Gate = GATE_PROPOSAL,
  c: MeasureCriteria = MEASURE,
): GateVerdict {
  const valid = (l: GateLevel) => measurementChecks(l, c).every((x) => x.ok);
  const at = levels.find((l) => l.level === g.level);
  const p95 = at?.sql?.p95;
  const verdict: GateVerdict["verdict"] =
    !at || !valid(at) || typeof p95 !== "number" || !Number.isFinite(p95)
      ? "not measured"
      : p95 < g.p95_ms
        ? "met"
        : "not met";
  return {
    status: "proposal: reported, not enforced (pending the owner's approval)",
    rule: `release gate (proposal): SQL p95 < ${g.p95_ms} ms at ${g.level} concurrent; at ${g.report.join(", ") || "-"} reported`,
    verdict,
    detail: at
      ? `at ${g.level} concurrent: SQL p95 ${p95 ?? "?"} ms (${valid(at) ? "valid measurement" : "measurement not valid"})`
      : `level ${g.level} not measured`,
    reported: g.report.map((level) => {
      const l = levels.find((x) => x.level === level);
      const v = l?.sql?.p95;
      const ok = typeof v === "number" && Number.isFinite(v);
      return {
        level,
        sql_p95: ok ? v : null,
        under_threshold: ok ? v < g.p95_ms : null,
        valid: !!l && valid(l),
        measured: !!l,
      };
    }),
  };
}

/** The summary's line for a level: what the judges read, plus the headline numbers. */
export function summaryLine(r: LevelReport) {
  return {
    level: r.level,
    clients: r.clients,
    batch: r.batch,
    searches: r.searches,
    ok: r.ok,
    errors: r.errors,
    throughput_per_s: r.throughput_per_s,
    sql: r.sql,
    client: r.client,
    sql_at_level: r.sql_at_level,
    database_concurrency: r.database_concurrency,
    per_search: r.per_search,
    by_bucket_p95: Object.fromEntries(
      Object.entries(r.by_bucket).map(([k, v]) => [k, { p50: v.p50, p95: v.p95 }]),
    ),
  };
}
export type SummaryLine = ReturnType<typeof summaryLine>;

// ---- one message: a batch of searches in ONE read-only transaction, in one round trip -------------------------

export interface MessageItem {
  q: string;
  type: string | null;
  country: string | null;
  household: string;
  /** People's path only: the household's member, whose claims the search runs with. */
  user?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The text of one message (simple query protocol, one round trip): a READ-ONLY transaction with the role for this
 * transaction only (as PostgREST does per request), a statement timeout, and per search the server's clock before
 * and after it (clock_timestamp; the backend's pid with the first). Everything is a literal: uuids are checked,
 * text is escaped by the driver's `escape`. Pure.
 */
export function messageSql(
  items: readonly MessageItem[],
  o: { path: "pilot" | "public"; timeoutMs: number; escape: (s: string) => string },
): string {
  if (!Number.isInteger(o.timeoutMs) || o.timeoutMs < 100)
    throw new Error("the statement timeout is a whole number of milliseconds (at least 100)");
  const lit = (v: string | null) => (v === null ? "null" : o.escape(v));
  const fn = o.path === "pilot" ? "public.catalog_search_pilot" : "public.catalog_search";
  const now = "(extract(epoch from clock_timestamp()) * 1000)::float8";
  const parts = [
    "begin transaction read only",
    o.path === "pilot" ? "set local role service_role" : "set local role authenticated",
    `set local statement_timeout = ${o.timeoutMs}`,
  ];
  // the service role acts without a person's claims (pool.ts transactionPreamble)
  if (o.path === "pilot")
    parts.push(
      "select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)",
    );
  for (const it of items) {
    if (!UUID.test(it.household)) throw new Error("a household id must be a uuid");
    if (o.path === "public") {
      if (!it.user || !UUID.test(it.user))
        throw new Error("the people's path needs the household's member (a uuid) for every search");
      const claims = JSON.stringify({ sub: it.user, role: "authenticated" });
      parts.push(
        `select set_config('request.jwt.claims', ${lit(claims)}, true), set_config('request.jwt.claim.sub', ${lit(it.user)}, true)`,
      );
    }
    parts.push(`select ${now} as t0, pg_backend_pid() as pid`);
    parts.push(
      `select count(*)::int as n from ${fn}(${lit(it.household)}::uuid, ${lit(it.q)}, ${lit(it.type)}, ${lit(it.country)}, null, 8)`,
    );
    parts.push(`select ${now} as t1`);
  }
  parts.push("commit");
  return parts.join("; ");
}

/** The searches of a message's results, in order: server start and end, pid, rows. Pure. */
export function parseMessage(
  results: ReadonlyArray<{ rows: ReadonlyArray<Record<string, unknown>> }>,
): Array<{ start: number; end: number; pid: number; rows: number }> {
  const out: Array<{ start: number; end: number; pid: number; rows: number }> = [];
  let cur: { start: number; pid: number; rows: number } | null = null;
  for (const r of results) {
    const row = r.rows[0];
    if (!row) continue;
    if ("t0" in row) cur = { start: Number(row.t0), pid: Number(row.pid), rows: NaN };
    else if ("n" in row && cur) cur.rows = Number(row.n);
    else if ("t1" in row && cur) {
      out.push({ ...cur, end: Number(row.t1) });
      cur = null;
    }
  }
  return out;
}
