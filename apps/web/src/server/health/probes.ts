import "server-only";
import {
  AI_HEALTH,
  assertMeasurement,
  classifyAiWindow,
  classifyBuckets,
  classifyCiRun,
  classifyCronJob,
  classifyDeployment,
  classifyLatency,
  type HealthDetail,
  type HealthStatus,
  type Measurement,
} from "@cellr/domain";
import type { HealthEnv } from "@/server/env";
import {
  HealthNotInstalledError,
  type AiTaskRow,
  type HealthPort,
} from "@/server/privileged/health";
import { AI_TASKS, EXPECTED_BUCKETS, EXPECTED_CRON_JOBS, PROBES } from "./catalogue";

/**
 * THE PROBES (System Intelligence sprint 2, ADR-002). Server-side only, each bounded by a hard timeout, none making
 * a paid call: the database and Storage through the service role, Auth's health endpoint, pg_cron's own history,
 * AI health from the calls people already made, and — only when a token is configured — GitHub and Vercel.
 *
 * A probe returns codes and numbers only. An error never becomes text in a sample: it is reduced to a reason code
 * (timeout, unreachable, http_503, …) by `reasonOf`, and anything a probe cannot judge is `unknown`.
 */

export interface ProbeDeps {
  port: HealthPort;
  fetch: typeof fetch;
  supabaseUrl: string;
  publishableKey: string;
  health: HealthEnv;
  now: Date;
  timeoutMs: number;
  /** How long the round's own first write took (health_begin_round): the db.write measurement. */
  writeLatencyMs: number;
}

/** Thresholds above which an answering service counts as slow. */
export const SLOW_MS = { db: 1000, auth: 1500, storage: 2000, provider: 2500 } as const;

class ProbeTimeout extends Error {
  constructor() {
    super("probe timeout");
    this.name = "ProbeTimeout";
  }
}

/** Resolves with the work, or rejects after `ms` (the work itself is abandoned, not awaited). */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProbeTimeout()), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** An error, as a reason code: never its message. */
export function reasonOf(e: unknown): string {
  if (e instanceof ProbeTimeout) return "timeout";
  if (e instanceof HealthNotInstalledError) return "not_installed";
  const name = e instanceof Error ? e.name : "";
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  if (e instanceof TypeError) return "unreachable"; // fetch: DNS, refused, reset, TLS
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Za-z0-9]{1,12}$/.test(code))
    return `rpc_${code.toLowerCase()}`;
  return "error";
}

const m = (
  probe: string,
  status: HealthStatus,
  reason: string,
  latencyMs: number | null,
  detail: HealthDetail = {},
): Measurement =>
  assertMeasurement({
    probe,
    status,
    reason,
    latencyMs: latencyMs === null ? null : Math.max(0, Math.round(latencyMs)),
    detail,
  });

/** Times `work`; a failure is the probe's `failed` measurement with its reason code. */
async function timed<T>(
  work: () => Promise<T>,
  ms: number,
): Promise<
  { ok: true; value: T; latencyMs: number } | { ok: false; reason: string; latencyMs: number }
> {
  const start = performance.now();
  try {
    const value = await withTimeout(work(), ms);
    return { ok: true, value, latencyMs: performance.now() - start };
  } catch (e) {
    return { ok: false, reason: reasonOf(e), latencyMs: performance.now() - start };
  }
}

async function dbRead(d: ProbeDeps): Promise<Measurement[]> {
  const r = await timed(() => d.port.ping(), d.timeoutMs);
  if (!r.ok) return [m("db.read", "failed", r.reason, r.latencyMs)];
  if (r.value.inRecovery)
    return [m("db.read", "degraded", "in_recovery", r.latencyMs, { inRecovery: true })];
  const c = classifyLatency(r.latencyMs, SLOW_MS.db);
  return [m("db.read", c.status, c.reason, r.latencyMs, { inRecovery: false })];
}

function dbWrite(d: ProbeDeps): Measurement[] {
  const c = classifyLatency(d.writeLatencyMs, SLOW_MS.db);
  return [m("db.write", c.status, c.reason, d.writeLatencyMs)];
}

async function authApi(d: ProbeDeps): Promise<Measurement[]> {
  const r = await timed(
    () =>
      d.fetch(`${d.supabaseUrl}/auth/v1/health`, {
        headers: { apikey: d.publishableKey, "x-cellr-probe": "1" },
        signal: AbortSignal.timeout(d.timeoutMs),
        cache: "no-store",
      }),
    d.timeoutMs,
  );
  if (!r.ok) return [m("auth.api", "failed", r.reason, r.latencyMs)];
  await r.value.body?.cancel().catch(() => {});
  if (!r.value.ok) return [m("auth.api", "failed", `http_${r.value.status}`, r.latencyMs)];
  const c = classifyLatency(r.latencyMs, SLOW_MS.auth);
  return [m("auth.api", c.status, c.reason, r.latencyMs)];
}

async function storageApi(d: ProbeDeps): Promise<Measurement[]> {
  const r = await timed(() => d.port.buckets(), d.timeoutMs);
  if (!r.ok) return [m("storage.api", "failed", r.reason, r.latencyMs)];
  const b = classifyBuckets(r.value, EXPECTED_BUCKETS);
  const detail = { buckets: r.value.length, missing: b.missing };
  if (b.status !== "healthy") return [m("storage.api", b.status, b.reason, r.latencyMs, detail)];
  const c = classifyLatency(r.latencyMs, SLOW_MS.storage);
  return [m("storage.api", c.status, c.reason, r.latencyMs, detail)];
}

async function cronJobs(d: ProbeDeps): Promise<Measurement[]> {
  const ids = EXPECTED_CRON_JOBS.map((j) => `cron.${j.name}`);
  const r = await timed(() => d.port.cronJobs(), d.timeoutMs);
  if (!r.ok)
    return [
      m("cron.extension", "failed", r.reason, r.latencyMs),
      ...ids.map((id) => m(id, "unknown", "scheduler_unreadable", null)),
    ];
  if (!r.value.available)
    return [
      m("cron.extension", "unknown", "not_available", r.latencyMs),
      ...ids.map((id) => m(id, "unknown", "not_available", null)),
    ];
  const jobs = r.value.jobs;
  return [
    m("cron.extension", "healthy", "ok", r.latencyMs, { jobs: jobs.length }),
    ...EXPECTED_CRON_JOBS.map((j) => {
      const job = jobs.find((x) => x.name === j.name) ?? null;
      const c = classifyCronJob(job, d.now);
      const last = job?.lastStart ? Date.parse(job.lastStart) : NaN;
      return m(`cron.${j.name}`, c.status, c.reason, null, {
        active: job?.active ?? false,
        failures24h: job?.failures24h ?? 0,
        lastRunAgeSec: Number.isFinite(last) ? Math.round((d.now.getTime() - last) / 1000) : null,
      });
    }),
  ];
}

const aiDetail = (s: {
  calls: number;
  failed: number;
  fallback: number;
  p95Ms: number | null;
}) => ({
  calls: s.calls,
  failed: s.failed,
  fallback: s.fallback,
  p95Ms: s.p95Ms,
});

async function aiTraffic(d: ProbeDeps): Promise<Measurement[]> {
  const ids = ["ai.all", ...AI_TASKS.map((t) => `ai.${t.task}`)];
  const from = new Date(d.now.getTime() - AI_HEALTH.windowMinutes * 60_000);
  const r = await timed(() => d.port.aiWindow(from, d.now), d.timeoutMs);
  if (!r.ok) return ids.map((id) => m(id, "unknown", "usage_unreadable", null));
  const rows = r.value;
  const byTask = new Map<string, AiTaskRow>(rows.map((row) => [row.task, row]));
  const all = rows.reduce(
    (a, row) => ({
      calls: a.calls + row.calls,
      failed: a.failed + row.failed,
      fallback: a.fallback + row.fallback,
      // the slowest task's 95th percentile: an upper bound for the whole, not a percentile of it
      p95Ms: row.p95Ms === null ? a.p95Ms : Math.max(a.p95Ms ?? 0, row.p95Ms),
    }),
    { calls: 0, failed: 0, fallback: 0, p95Ms: null as number | null },
  );
  const allC = classifyAiWindow(all);
  return [
    m("ai.all", allC.status, allC.reason, null, aiDetail(all)),
    ...AI_TASKS.map((t) => {
      const s = byTask.get(t.task) ?? { calls: 0, failed: 0, fallback: 0, p95Ms: null };
      const c = classifyAiWindow(s);
      return m(`ai.${t.task}`, c.status, c.reason, null, aiDetail(s));
    }),
  ];
}

async function ciStatus(d: ProbeDeps): Promise<Measurement[]> {
  const gh = d.health.github;
  if (!gh) return [m("delivery.ci", "unknown", "not_configured", null)];
  const r = await timed(
    () =>
      d.fetch(
        `https://api.github.com/repos/${gh.repo}/actions/runs?branch=main&per_page=1&exclude_pull_requests=true`,
        {
          headers: {
            Authorization: `Bearer ${gh.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "cellr-health-monitor",
          },
          signal: AbortSignal.timeout(d.timeoutMs),
          cache: "no-store",
        },
      ),
    d.timeoutMs,
  );
  // the provider not answering is not CI failing: we just do not know
  if (!r.ok) return [m("delivery.ci", "unknown", `provider_${r.reason}`, r.latencyMs)];
  if (!r.value.ok) {
    await r.value.body?.cancel().catch(() => {});
    return [m("delivery.ci", "unknown", `provider_http_${r.value.status}`, r.latencyMs)];
  }
  const body = (await r.value.json().catch(() => null)) as {
    workflow_runs?: Array<{ status?: unknown; conclusion?: unknown }>;
  } | null;
  const run = body?.workflow_runs?.[0];
  if (!run || typeof run.status !== "string")
    return [m("delivery.ci", "unknown", "no_runs", r.latencyMs)];
  const c = classifyCiRun({
    status: run.status,
    conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
  });
  return [m("delivery.ci", c.status, c.reason, r.latencyMs)];
}

async function deployStatus(d: ProbeDeps): Promise<Measurement[]> {
  const v = d.health.vercel;
  if (!v) return [m("delivery.deploy", "unknown", "not_configured", null)];
  const q = new URLSearchParams({ projectId: v.projectId, target: "production", limit: "1" });
  if (v.teamId) q.set("teamId", v.teamId);
  const r = await timed(
    () =>
      d.fetch(`https://api.vercel.com/v6/deployments?${q}`, {
        headers: { Authorization: `Bearer ${v.token}`, "User-Agent": "cellr-health-monitor" },
        signal: AbortSignal.timeout(d.timeoutMs),
        cache: "no-store",
      }),
    d.timeoutMs,
  );
  if (!r.ok) return [m("delivery.deploy", "unknown", `provider_${r.reason}`, r.latencyMs)];
  if (!r.value.ok) {
    await r.value.body?.cancel().catch(() => {});
    return [m("delivery.deploy", "unknown", `provider_http_${r.value.status}`, r.latencyMs)];
  }
  const body = (await r.value.json().catch(() => null)) as {
    deployments?: Array<{ state?: unknown; readyState?: unknown }>;
  } | null;
  const dep = body?.deployments?.[0];
  const state = typeof dep?.state === "string" ? dep.state : dep?.readyState;
  if (typeof state !== "string")
    return [m("delivery.deploy", "unknown", "no_deployments", r.latencyMs)];
  const c = classifyDeployment(state);
  return [m("delivery.deploy", c.status, c.reason, r.latencyMs)];
}

const GROUPS: ReadonlyArray<(d: ProbeDeps) => Promise<Measurement[]> | Measurement[]> = [
  dbRead,
  dbWrite,
  authApi,
  storageApi,
  cronJobs,
  aiTraffic,
  ciStatus,
  deployStatus,
];

/**
 * Runs every probe at once and returns exactly one measurement per declared probe (monitor.round excepted: the
 * round adds it). A probe whose own code crashed is `unknown` (probe_error): the check could not judge, which says
 * nothing either way about the component — and is never healthy. Never throws.
 */
export async function runProbes(d: ProbeDeps): Promise<Measurement[]> {
  const settled = await Promise.allSettled(
    GROUPS.map(async (g) => withTimeout(Promise.resolve(g(d)), d.timeoutMs + 500)),
  );
  const out = new Map<string, Measurement>();
  for (const s of settled)
    if (s.status === "fulfilled") for (const x of s.value) out.set(x.probe, x);
  return PROBES.filter((p) => p.id !== "monitor.round").map(
    (p) => out.get(p.id) ?? m(p.id, "unknown", "probe_error", null),
  );
}
