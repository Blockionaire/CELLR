import { describe, expect, it } from "vitest";
import {
  AI_HEALTH,
  HEALTH_INTERVAL_SEC,
  HEALTH_STALE_SEC,
  assertMeasurement,
  classifyAiWindow,
  classifyBuckets,
  classifyCiRun,
  classifyCronJob,
  classifyDeployment,
  classifyLatency,
  cronIntervalSec,
  evaluateProbe,
  healthOverlay,
  monitorState,
  summarizeHealth,
  worstStatus,
  type HealthRound,
  type HealthSample,
  type ProbeDefinition,
} from "./system-health";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000).toISOString();

const probe = (
  id: string,
  components: string[],
  staleAfterSec = HEALTH_STALE_SEC,
): ProbeDefinition => ({
  id,
  label: id,
  kind: "infrastructure",
  components,
  staleAfterSec,
  proves: "it answers",
  doesNotProve: "that the feature works",
});
const sample = (
  p: string,
  status: HealthSample["status"],
  secondsAgo: number,
  reason = status === "healthy" ? "ok" : "x",
): HealthSample => ({
  probe: p,
  status,
  reason,
  latencyMs: 12,
  detail: {},
  measuredAt: ago(secondsAgo),
});
const round = (id: number, finishedSecAgo: number | null): HealthRound => ({
  id,
  trigger: "heartbeat",
  startedAt: ago((finishedSecAgo ?? 0) + 5),
  finishedAt: finishedSecAgo === null ? null : ago(finishedSecAgo),
  outcome: finishedSecAgo === null ? null : "ok",
});

describe("a missing, stale or failed measurement is never healthy", () => {
  const db = probe("db.query", ["supabase-postgres"]);

  it("no sample at all is unknown (never_measured)", () => {
    const h = evaluateProbe(db, undefined, NOW);
    expect(h).toMatchObject({ status: "unknown", reason: "never_measured", measuredAt: null });
  });
  it("a healthy sample older than the limit is unknown (stale), and keeps what it last said", () => {
    const h = evaluateProbe(db, sample("db.query", "healthy", HEALTH_STALE_SEC + 1), NOW);
    expect(h).toMatchObject({ status: "unknown", reason: "stale", lastStatus: "healthy" });
  });
  it("a fresh healthy sample is healthy, right up to the limit", () => {
    expect(evaluateProbe(db, sample("db.query", "healthy", HEALTH_STALE_SEC), NOW).status).toBe(
      "healthy",
    );
  });
  it("a sample from the future proves nothing (clock_skew)", () => {
    const h = evaluateProbe(db, sample("db.query", "healthy", -3600), NOW);
    expect(h).toMatchObject({ status: "unknown", reason: "clock_skew" });
  });
  it("an unreadable time is treated as no sample", () => {
    const h = evaluateProbe(db, { ...sample("db.query", "healthy", 1), measuredAt: "soon" }, NOW);
    expect(h.status).toBe("unknown");
  });
  it("a failed sample stays failed while fresh", () => {
    expect(evaluateProbe(db, sample("db.query", "failed", 10, "timeout"), NOW)).toMatchObject({
      status: "failed",
      reason: "timeout",
    });
  });
});

describe("roll-up: the worst wins, and a gap is never hidden", () => {
  it("orders failed > degraded > unknown > healthy", () => {
    expect(worstStatus(["healthy", "unknown"])).toBe("unknown");
    expect(worstStatus(["unknown", "degraded", "healthy"])).toBe("degraded");
    expect(worstStatus(["degraded", "failed"])).toBe("failed");
    expect(worstStatus(["healthy", "healthy"])).toBe("healthy");
  });
  it("nothing at all is unknown", () => {
    expect(worstStatus([])).toBe("unknown");
  });

  it("a component is the worst of its probes; one with no probe is left out (not measured)", () => {
    const probes = [
      probe("db.query", ["supabase-postgres"]),
      probe("db.write", ["supabase-postgres"]),
      probe("auth.api", ["supabase-auth"]),
    ];
    const o = summarizeHealth(
      probes,
      {
        rounds: [round(1, 30)],
        samples: [sample("db.query", "healthy", 30), sample("auth.api", "healthy", 30)],
      },
      ["supabase-postgres", "supabase-auth", "svc-cellar"],
      NOW,
    );
    // db.write never measured: the database is unknown, although its other check passes
    expect(o.components.get("supabase-postgres")).toMatchObject({
      status: "unknown",
      reason: "never_measured",
    });
    expect(o.components.get("supabase-auth")?.status).toBe("healthy");
    expect(o.components.has("svc-cellar")).toBe(false);
    expect(o.overall).toBe("unknown");
    expect(o.counts).toEqual({ healthy: 2, degraded: 0, failed: 0, unknown: 1 });
  });

  it("uses the newest sample per probe, whatever the order they come in", () => {
    const o = summarizeHealth(
      [probe("db.query", ["supabase-postgres"])],
      {
        rounds: [round(1, 30)],
        samples: [sample("db.query", "healthy", 30), sample("db.query", "failed", 900, "timeout")],
      },
      ["supabase-postgres"],
      NOW,
    );
    expect(o.probes[0]!.status).toBe("healthy");
  });

  it("when the monitor stopped, every probe reads unknown, and the overlay says so", () => {
    const o = summarizeHealth(
      [probe("db.query", ["supabase-postgres"])],
      {
        rounds: [round(1, HEALTH_STALE_SEC + 60)],
        samples: [sample("db.query", "healthy", HEALTH_STALE_SEC + 60)],
      },
      ["supabase-postgres"],
      NOW,
    );
    expect(o.monitor.state).toBe("stopped");
    expect(o.overall).toBe("unknown");
    expect(healthOverlay(o)).toEqual({
      state: "available",
      overall: "unknown",
      monitor: "stopped",
      components: { "supabase-postgres": { status: "unknown", reason: "stale" } },
    });
  });
});

describe("the monitor's own state", () => {
  it("never: no round has finished (a started one does not count)", () => {
    expect(monitorState([], NOW).state).toBe("never");
    expect(monitorState([round(1, null)], NOW).state).toBe("never");
  });
  it("running, late, stopped by the age of the newest finished round", () => {
    expect(monitorState([round(1, 60)], NOW).state).toBe("running");
    expect(monitorState([round(1, HEALTH_INTERVAL_SEC * 2)], NOW).state).toBe("late");
    expect(monitorState([round(1, HEALTH_STALE_SEC + 1)], NOW).state).toBe("stopped");
    expect(monitorState([round(2, null), round(1, 60)], NOW)).toMatchObject({
      state: "running",
      lastRound: { id: 1 },
      ageSec: 60,
    });
  });
});

describe("classifiers", () => {
  it("latency", () => {
    expect(classifyLatency(100, 1000)).toEqual({ status: "healthy", reason: "ok" });
    expect(classifyLatency(1001, 1000)).toEqual({ status: "degraded", reason: "slow" });
  });

  it("AI: no traffic is unknown, never healthy; no test call is made to find out", () => {
    expect(classifyAiWindow({ calls: 0, failed: 0, fallback: 0, p95Ms: null })).toEqual({
      status: "unknown",
      reason: "no_traffic",
    });
  });
  it("AI: error rates, fallbacks and slowness", () => {
    const ok = { calls: 20, failed: 0, fallback: 0, p95Ms: 2000 };
    expect(classifyAiWindow(ok).status).toBe("healthy");
    expect(classifyAiWindow({ ...ok, failed: 10 })).toEqual({
      status: "failed",
      reason: "error_rate_high",
    });
    expect(classifyAiWindow({ ...ok, failed: 2 })).toEqual({
      status: "degraded",
      reason: "errors",
    });
    expect(classifyAiWindow({ ...ok, failed: 1 }).status).toBe("healthy"); // 5% < 10%
    expect(classifyAiWindow({ ...ok, fallback: 4 })).toEqual({
      status: "degraded",
      reason: "fallbacks",
    });
    expect(classifyAiWindow({ ...ok, p95Ms: AI_HEALTH.degradedAboveP95Ms + 1 }).reason).toBe(
      "slow",
    );
  });
  it("AI: a few calls never make a failure rate, but any failure among them is degraded", () => {
    expect(classifyAiWindow({ calls: 2, failed: 2, fallback: 0, p95Ms: null })).toEqual({
      status: "degraded",
      reason: "errors",
    });
  });

  it("cron intervals for the schedules our migrations use", () => {
    expect(cronIntervalSec("*/15 * * * *")).toBe(900);
    expect(cronIntervalSec("41 * * * *")).toBe(3600);
    expect(cronIntervalSec("17 3 * * *")).toBe(86_400);
    expect(cronIntervalSec("0 */6 * * *")).toBe(21_600);
    expect(cronIntervalSec("30 seconds")).toBe(30);
    expect(cronIntervalSec("0 8 * * 1-5")).toBeNull();
  });

  it("cron jobs from pg_cron's own history", () => {
    const job = {
      schedule: "*/15 * * * *",
      active: true,
      lastStart: ago(300),
      lastStatus: "succeeded",
      failures24h: 0,
    };
    expect(classifyCronJob(job, NOW)).toEqual({ status: "healthy", reason: "ok" });
    expect(classifyCronJob(null, NOW)).toEqual({ status: "failed", reason: "not_scheduled" });
    expect(classifyCronJob({ ...job, active: false }, NOW).reason).toBe("inactive");
    expect(classifyCronJob({ ...job, lastStart: null }, NOW)).toEqual({
      status: "unknown",
      reason: "no_runs_recorded",
    });
    expect(classifyCronJob({ ...job, lastStatus: "failed" }, NOW)).toEqual({
      status: "failed",
      reason: "last_run_failed",
    });
    expect(classifyCronJob({ ...job, lastStart: ago(900 * 3 + 301) }, NOW).reason).toBe("overdue");
    expect(classifyCronJob({ ...job, failures24h: 2 }, NOW)).toEqual({
      status: "degraded",
      reason: "recent_failures",
    });
  });

  it("buckets: every bucket the migrations create must exist", () => {
    expect(classifyBuckets(["a", "b", "c"], ["a", "b"]).status).toBe("healthy");
    expect(classifyBuckets(["a"], ["a", "b"])).toEqual({
      status: "failed",
      reason: "buckets_missing",
      missing: 1,
    });
  });

  it("CI and deployments", () => {
    expect(classifyCiRun({ status: "completed", conclusion: "success" }).status).toBe("healthy");
    expect(classifyCiRun({ status: "completed", conclusion: "failure" }).reason).toBe("ci_failing");
    expect(classifyCiRun({ status: "in_progress", conclusion: null }).reason).toBe("running");
    expect(classifyCiRun({ status: "completed", conclusion: "Weird Thing!" }).reason).toBe(
      "ci_other",
    );
    expect(classifyDeployment("READY").status).toBe("healthy");
    expect(classifyDeployment("ERROR")).toEqual({
      status: "degraded",
      reason: "last_deploy_failed",
    });
    expect(classifyDeployment("SOMETHING").status).toBe("unknown");
  });
});

describe("what a probe may store", () => {
  const ok = {
    probe: "db.query",
    status: "healthy",
    reason: "ok",
    latencyMs: 5,
    detail: {},
  } as const;
  it("accepts codes and numbers", () => {
    expect(() =>
      assertMeasurement({ ...ok, detail: { rows: 3, inRecovery: false } }),
    ).not.toThrow();
  });
  it("refuses a free-text reason (an error message must never be stored or shown)", () => {
    expect(() =>
      assertMeasurement({ ...ok, reason: 'relation "x" does not exist at character 15' }),
    ).toThrow();
  });
  it("refuses text in the detail, and too many fields", () => {
    expect(() =>
      assertMeasurement({ ...ok, detail: { msg: "secret" } as unknown as Record<string, number> }),
    ).toThrow();
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, i]));
    expect(() => assertMeasurement({ ...ok, detail: many })).toThrow();
  });
  it("refuses an unknown status", () => {
    expect(() => assertMeasurement({ ...ok, status: "fine" as unknown as "healthy" })).toThrow();
  });
});
