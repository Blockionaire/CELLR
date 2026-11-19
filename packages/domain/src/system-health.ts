import { z } from "zod";

/**
 * SYSTEM HEALTH (System Intelligence sprint 2, ADR-002). The measurement model behind the admin's Health view and
 * the map's health overlay: what a measurement is, how one is judged, and how measurements roll up to a component.
 * Pure: no I/O, no clock (every function takes `now`), no data. The probes that measure live in apps/web
 * (src/server/system/health/), server-side only.
 *
 * Three rules hold everywhere:
 *  1. Missing, stale or failed is never healthy. No sample, an old sample, a sample from the future, or a probe that
 *     could not run all read `unknown` or `failed`, never `healthy`.
 *  2. A gap is never hidden. In a roll-up `unknown` outranks `healthy`, so one unmeasured aspect keeps a component
 *     from showing healthy.
 *  3. A check proves only what it measures. Every probe declares what a pass shows and what it does not; a passing
 *     check means "this aspect answered", not "the feature works".
 */

export const HEALTH_STATUSES = ["healthy", "degraded", "failed", "unknown"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const HEALTH_STATUS_LABEL: Readonly<Record<HealthStatus, string>> = {
  healthy: "Healthy",
  degraded: "Degraded",
  failed: "Failed",
  unknown: "Unknown",
};

/** Roll-up order: the worst wins, and unknown outranks healthy (a gap in measurement is never hidden). */
export const HEALTH_RANK: Readonly<Record<HealthStatus, number>> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  failed: 3,
};

/** The worst of some statuses; nothing at all is `unknown`. */
export function worstStatus(statuses: Iterable<HealthStatus>): HealthStatus {
  let worst: HealthStatus | null = null;
  for (const s of statuses) if (worst === null || HEALTH_RANK[s] > HEALTH_RANK[worst]) worst = s;
  return worst ?? "unknown";
}

/** How often the heartbeat asks for a round (ADR-002 D1: GitHub Actions, every 10 minutes). */
export const HEALTH_INTERVAL_SEC = 600;
/**
 * A sample older than this reads `unknown`. Three intervals: scheduled workflows are often late by many minutes,
 * and one late or lost round must not turn the whole board unknown.
 */
export const HEALTH_STALE_SEC = 3 * HEALTH_INTERVAL_SEC;
/** A sample this far in the future means a clock is wrong: it proves nothing. */
export const HEALTH_CLOCK_SKEW_SEC = 300;
/** Two rounds closer together than this are one: the second is refused (bounded cost, whoever calls). */
export const HEALTH_MIN_ROUND_GAP_SEC = 60;
/** The longest any single probe may take before it is abandoned and recorded as `failed` (timeout). */
export const HEALTH_PROBE_TIMEOUT_MS = 3_000;
/** How far back the history strip reaches. */
export const HEALTH_HISTORY_HOURS = 24;
/** How long samples are kept (the retention job in 20261124000047). */
export const HEALTH_RETENTION_DAYS = 14;

/**
 * The only words a probe may store as its reason: a machine code, never an error message or a value. No dots, colons
 * or dashes, so not even a host name or an address fits.
 */
export const HEALTH_REASON = /^[a-z0-9_]{1,64}$/;
export const PROBE_ID = /^[a-z0-9_.-]{1,48}$/;

export type ProbeKind = "monitor" | "infrastructure" | "job" | "traffic" | "delivery";

export const PROBE_KIND_LABEL: Readonly<Record<ProbeKind, string>> = {
  monitor: "Monitor",
  infrastructure: "Infrastructure",
  job: "Scheduled jobs",
  traffic: "Live traffic",
  delivery: "Build & deploy",
};

/** A declared measurement. Public by design: what is measured, never what was measured. */
export interface ProbeDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: ProbeKind;
  /** The architecture-register components this measurement speaks for (checked against the register in a test). */
  readonly components: readonly string[];
  /** A sample older than this reads `unknown`. */
  readonly staleAfterSec: number;
  /** What a passing measurement shows. */
  readonly proves: string;
  /** What it does not show: the honest limit of the check. */
  readonly doesNotProve: string;
}

/** Small, bounded facts a probe may keep next to its status: counts, durations, flags. No text from outside. */
export type HealthDetail = Readonly<Record<string, number | boolean | null>>;

const DetailSchema = z
  .record(
    z.string().regex(/^[a-zA-Z0-9_]{1,40}$/),
    z.union([z.number().finite(), z.boolean(), z.null()]),
  )
  .refine((d) => Object.keys(d).length <= 24, "too many detail fields");

/** One stored measurement, as the health RPCs return it. */
export const HealthSampleSchema = z.object({
  probe: z.string().regex(PROBE_ID),
  status: z.enum(HEALTH_STATUSES),
  reason: z.string().regex(HEALTH_REASON),
  latencyMs: z.number().int().nonnegative().nullable(),
  detail: DetailSchema,
  measuredAt: z.string(),
});
export type HealthSample = z.infer<typeof HealthSampleSchema>;

export const HEALTH_TRIGGERS = ["heartbeat", "manual"] as const;
export type HealthTrigger = (typeof HEALTH_TRIGGERS)[number];
export const ROUND_OUTCOMES = ["ok", "partial", "failed"] as const;
export type RoundOutcome = (typeof ROUND_OUTCOMES)[number];

export const HealthRoundSchema = z.object({
  id: z.number().int().positive(),
  trigger: z.enum(HEALTH_TRIGGERS),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  outcome: z.enum(ROUND_OUTCOMES).nullable(),
});
export type HealthRound = z.infer<typeof HealthRoundSchema>;

/** health_latest(): the last rounds and the newest sample per probe. */
export const HealthLatestSchema = z.object({
  rounds: z.array(HealthRoundSchema),
  samples: z.array(HealthSampleSchema),
});
export type HealthLatest = z.infer<typeof HealthLatestSchema>;

/** health_history(): every sample in the window, oldest first (bounded by the RPC). */
export const HealthHistorySchema = z.array(HealthSampleSchema.omit({ detail: true }));
export type HealthHistorySample = z.infer<typeof HealthHistorySchema>[number];

/** A measurement as a probe returns it, before it is stored. */
export interface Measurement {
  readonly probe: string;
  readonly status: HealthStatus;
  readonly reason: string;
  readonly latencyMs: number | null;
  readonly detail: HealthDetail;
}

/** Reject anything a probe must not store: an unknown probe, a free-text reason, an oversized or textual detail. */
export function assertMeasurement(m: Measurement): Measurement {
  HealthSampleSchema.omit({ measuredAt: true }).parse(m);
  return m;
}

const parseTime = (iso: string | null | undefined) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** A probe, judged at `now` from its newest sample. */
export interface ProbeHealth {
  readonly probe: ProbeDefinition;
  readonly status: HealthStatus;
  readonly reason: string;
  /** The newest sample's time, fresh or not; null when there never was one. */
  readonly measuredAt: string | null;
  readonly ageSec: number | null;
  /** The newest sample's own status, also when it is too old to count (shown as "last seen"). */
  readonly lastStatus: HealthStatus | null;
  readonly latencyMs: number | null;
  readonly detail: HealthDetail;
}

/**
 * Judges one probe. Without a sample it is `unknown` (never_measured); with a sample older than the probe's limit it
 * is `unknown` (stale) whatever that sample said; with a sample from the future it is `unknown` (clock_skew). Only a
 * fresh sample's own status counts.
 */
export function evaluateProbe(
  probe: ProbeDefinition,
  sample: HealthSample | undefined,
  now: Date,
): ProbeHealth {
  const at = parseTime(sample?.measuredAt);
  if (!sample || at === null)
    return {
      probe,
      status: "unknown",
      reason: "never_measured",
      measuredAt: null,
      ageSec: null,
      lastStatus: null,
      latencyMs: null,
      detail: {},
    };
  const ageSec = Math.round((now.getTime() - at) / 1000);
  const base = {
    probe,
    measuredAt: sample.measuredAt,
    ageSec,
    lastStatus: sample.status,
    latencyMs: sample.latencyMs,
    detail: sample.detail,
  };
  if (ageSec < -HEALTH_CLOCK_SKEW_SEC) return { ...base, status: "unknown", reason: "clock_skew" };
  if (ageSec > probe.staleAfterSec) return { ...base, status: "unknown", reason: "stale" };
  return { ...base, status: sample.status, reason: sample.reason };
}

/** A component's health: the worst of the probes that speak for it. No probe at all is `unknown` (not_measured). */
export interface ComponentHealth {
  readonly componentId: string;
  readonly status: HealthStatus;
  readonly reason: string;
  readonly probes: readonly ProbeHealth[];
}

export type MonitorState = "running" | "late" | "failing" | "stopped" | "never";

/** The whole board at `now`. */
export interface HealthOverview {
  readonly now: string;
  readonly monitor: {
    readonly state: MonitorState;
    readonly lastRound: HealthRound | null;
    readonly ageSec: number | null;
  };
  readonly overall: HealthStatus;
  readonly probes: readonly ProbeHealth[];
  readonly components: ReadonlyMap<string, ComponentHealth>;
  readonly counts: HealthCounts;
}

export type HealthCounts = Readonly<Record<HealthStatus, number>>;

/** A round that started this long ago and is still not recorded failed to record. */
export const HEALTH_ROUND_OPEN_SEC = 60;

/**
 * The monitor itself:
 *  - `running` while finished rounds keep coming;
 *  - `failing` when the newest round started more than a minute ago and was never recorded (its results could not be
 *    written: the samples on show are older than they look);
 *  - `late` after one missed interval and a bit;
 *  - `stopped` when the newest finished round is older than the stale limit (every sample is then unknown);
 *  - `never` when no round has finished.
 */
export function monitorState(rounds: readonly HealthRound[], now: Date): HealthOverview["monitor"] {
  const byStart = [...rounds].sort(
    (a, b) => (parseTime(b.startedAt) ?? 0) - (parseTime(a.startedAt) ?? 0),
  );
  const finished = rounds
    .filter((r) => r.finishedAt && parseTime(r.finishedAt) !== null)
    .sort((a, b) => parseTime(b.finishedAt)! - parseTime(a.finishedAt)!);
  const last = finished[0] ?? null;
  if (!last) return { state: "never", lastRound: byStart[0] ?? null, ageSec: null };
  const ageSec = Math.round((now.getTime() - parseTime(last.finishedAt)!) / 1000);
  const newest = byStart[0]!;
  const newestStarted = parseTime(newest.startedAt) ?? 0;
  const openTooLong =
    !newest.finishedAt &&
    newestStarted > parseTime(last.startedAt)! &&
    (now.getTime() - newestStarted) / 1000 > HEALTH_ROUND_OPEN_SEC;
  const state: MonitorState =
    ageSec > HEALTH_STALE_SEC
      ? "stopped"
      : openTooLong
        ? "failing"
        : ageSec > HEALTH_INTERVAL_SEC * 1.5
          ? "late"
          : "running";
  return { state, lastRound: last, ageSec };
}

export function summarizeHealth(
  probes: readonly ProbeDefinition[],
  latest: HealthLatest,
  componentIds: readonly string[],
  now: Date,
): HealthOverview {
  const newest = new Map<string, HealthSample>();
  for (const s of latest.samples) {
    const prev = newest.get(s.probe);
    if (!prev || (parseTime(s.measuredAt) ?? 0) > (parseTime(prev.measuredAt) ?? 0))
      newest.set(s.probe, s);
  }
  const monitor = monitorState(latest.rounds, now);
  // the monitor's own check agrees with its state: late is degraded, failing to record is failed
  const judged = probes.map((p) => {
    const j = evaluateProbe(p, newest.get(p.id), now);
    if (p.kind !== "monitor" || j.status === "unknown") return j;
    if (monitor.state === "failing")
      return { ...j, status: "failed" as const, reason: "rounds_not_recorded" };
    if (monitor.state === "late") return { ...j, status: "degraded" as const, reason: "late" };
    return j;
  });
  const components = new Map<string, ComponentHealth>();
  for (const id of componentIds) {
    const mine = judged.filter((j) => j.probe.components.includes(id));
    if (mine.length === 0) continue;
    const status = worstStatus(mine.map((m) => m.status));
    const worst = mine.find((m) => m.status === status)!;
    components.set(id, { componentId: id, status, reason: worst.reason, probes: mine });
  }
  const counts = { healthy: 0, degraded: 0, failed: 0, unknown: 0 };
  for (const j of judged) counts[j.status] += 1;
  return {
    now: now.toISOString(),
    monitor,
    overall: worstStatus(judged.map((j) => j.status)),
    probes: judged,
    components,
    counts,
  };
}

/**
 * What the map receives: one status per measured component, or the reason there is none. Plain data, so a failing
 * monitor can hand the map `unavailable` and the map renders exactly as without health.
 */
export type HealthOverlay =
  | {
      readonly state: "available";
      readonly overall: HealthStatus;
      readonly monitor: MonitorState;
      readonly components: Readonly<
        Record<string, { readonly status: HealthStatus; readonly reason: string }>
      >;
    }
  | {
      readonly state: "unavailable";
      readonly reason: "not_installed" | "not_configured" | "error" | "timeout";
    };

export function healthOverlay(overview: HealthOverview): HealthOverlay {
  return {
    state: "available",
    overall: overview.overall,
    monitor: overview.monitor.state,
    components: Object.fromEntries(
      [...overview.components].map(([id, c]) => [id, { status: c.status, reason: c.reason }]),
    ),
  };
}

// ---- Classifiers: from raw facts to a status, one per kind of probe --------------------------------------------

/** A request that answered: healthy, or degraded when slower than `degradedAboveMs`. */
export function classifyLatency(
  latencyMs: number,
  degradedAboveMs: number,
): { status: HealthStatus; reason: string } {
  return latencyMs > degradedAboveMs
    ? { status: "degraded", reason: "slow" }
    : { status: "healthy", reason: "ok" };
}

/** Thresholds for AI traffic in one window. */
export const AI_HEALTH = {
  windowMinutes: 60,
  /** Below this many calls a failure rate means little: any failure is degraded, never failed. */
  minCalls: 5,
  failedAtErrorRate: 0.5,
  degradedAtErrorRate: 0.1,
  degradedAtFallbackRate: 0.2,
  degradedAboveP95Ms: 30_000,
} as const;

export interface AiWindowStats {
  /** Every recorded call in the window, fallbacks included. */
  readonly calls: number;
  /** error, timeout and invalid_output. */
  readonly failed: number;
  /** rate_limited and budget_exhausted: answered by the plain version instead of the AI. */
  readonly fallback: number;
  readonly p95Ms: number | null;
}

/**
 * AI health from real calls. No calls in the window is `unknown` (no_traffic): silence proves nothing, and no test
 * call is made to find out (that would cost money).
 */
export function classifyAiWindow(s: AiWindowStats): { status: HealthStatus; reason: string } {
  if (s.calls <= 0) return { status: "unknown", reason: "no_traffic" };
  const errorRate = s.failed / s.calls;
  if (s.calls >= AI_HEALTH.minCalls && errorRate >= AI_HEALTH.failedAtErrorRate)
    return { status: "failed", reason: "error_rate_high" };
  if (s.failed > 0 && (s.calls < AI_HEALTH.minCalls || errorRate >= AI_HEALTH.degradedAtErrorRate))
    return { status: "degraded", reason: "errors" };
  if (s.fallback / s.calls >= AI_HEALTH.degradedAtFallbackRate)
    return { status: "degraded", reason: "fallbacks" };
  if (s.p95Ms !== null && s.p95Ms > AI_HEALTH.degradedAboveP95Ms)
    return { status: "degraded", reason: "slow" };
  return { status: "healthy", reason: "ok" };
}

/**
 * The interval of a pg_cron schedule in seconds, for the shapes our migrations use ("*\/15 * * * *", "41 * * * *",
 * "17 3 * * *", "30 seconds"); null for anything else (judged against a day, conservatively).
 */
export function cronIntervalSec(schedule: string): number | null {
  const s = schedule.trim();
  const secs = /^(\d+) seconds$/.exec(s);
  if (secs) return Number(secs[1]);
  const f = s.split(/\s+/);
  if (f.length !== 5) return null;
  const [min, hour, dom, mon, dow] = f as [string, string, string, string, string];
  if (dom !== "*" || mon !== "*" || dow !== "*") return null;
  const every = (x: string) => /^\*\/(\d+)$/.exec(x)?.[1];
  const fixed = (x: string) => /^\d+$/.test(x);
  if (every(min) && hour === "*") return Number(every(min)) * 60;
  if (min === "*" && hour === "*") return 60;
  if (fixed(min) && hour === "*") return 3600;
  if (fixed(min) && every(hour)) return Number(every(hour)) * 3600;
  if (fixed(min) && fixed(hour)) return 86_400;
  return null;
}

export interface CronJobFacts {
  readonly schedule: string;
  readonly active: boolean;
  /** The newest run's start; null when pg_cron has no run for it. */
  readonly lastStart: string | null;
  /** pg_cron's status of the newest run (succeeded, failed, running, starting, …). */
  readonly lastStatus: string | null;
  /** Failed runs in the last 24 hours. */
  readonly failures24h: number;
}

/**
 * A scheduled job from pg_cron's own run history. A job that should have run three times over and did not is
 * `failed` (overdue); one that last failed is `failed`; earlier failures within a day are `degraded`. A job with no
 * recorded run is `unknown`: pg_cron keeps history only so long, and a new job has not run yet.
 */
export function classifyCronJob(
  job: CronJobFacts | null,
  now: Date,
): { status: HealthStatus; reason: string } {
  if (!job) return { status: "failed", reason: "not_scheduled" };
  if (!job.active) return { status: "degraded", reason: "inactive" };
  const started = parseTime(job.lastStart);
  if (started === null) return { status: "unknown", reason: "no_runs_recorded" };
  if (job.lastStatus === "failed") return { status: "failed", reason: "last_run_failed" };
  const interval = cronIntervalSec(job.schedule) ?? 86_400;
  if ((now.getTime() - started) / 1000 > interval * 3 + 300)
    return { status: "failed", reason: "overdue" };
  if (job.failures24h > 0) return { status: "degraded", reason: "recent_failures" };
  return { status: "healthy", reason: "ok" };
}

/** Storage answers, and every bucket the migrations create exists. */
export function classifyBuckets(
  found: readonly string[],
  expected: readonly string[],
): { status: HealthStatus; reason: string; missing: number } {
  const have = new Set(found);
  const missing = expected.filter((b) => !have.has(b)).length;
  return missing > 0
    ? { status: "failed", reason: "buckets_missing", missing }
    : { status: "healthy", reason: "ok", missing: 0 };
}

/** The newest CI run on the main branch (GitHub Actions' own words for status and conclusion). */
export function classifyCiRun(run: { status: string; conclusion: string | null }): {
  status: HealthStatus;
  reason: string;
} {
  // the run in progress proves nothing yet (callers ask for the newest completed run)
  if (run.status !== "completed") return { status: "unknown", reason: "running" };
  switch (run.conclusion) {
    case "success":
      return { status: "healthy", reason: "ok" };
    case "failure":
    case "timed_out":
    case "startup_failure":
      return { status: "degraded", reason: "ci_failing" };
    default: {
      // an outside word becomes part of a stored reason only if it is a plain short code
      const word =
        run.conclusion && /^[a-z_]{1,30}$/.test(run.conclusion) ? run.conclusion : "other";
      return { status: "unknown", reason: `ci_${word}` };
    }
  }
}

/**
 * The newest production deployment (Vercel's state words). A failed deployment leaves the previous one serving, so
 * it is `degraded` (the release did not go out), not `failed`: whether the app answers is the heartbeat's to say.
 */
export function classifyDeployment(state: string): { status: HealthStatus; reason: string } {
  switch (state) {
    case "READY":
      return { status: "healthy", reason: "ok" };
    case "BUILDING":
    case "QUEUED":
    case "INITIALIZING":
      // a deployment underway proves nothing yet (the probe asks for the newest finished one)
      return { status: "unknown", reason: "deploying" };
    case "ERROR":
    case "CANCELED":
      return { status: "degraded", reason: "last_deploy_failed" };
    default:
      return { status: "unknown", reason: "deploy_state_unknown" };
  }
}
