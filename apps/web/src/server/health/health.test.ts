import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthEnv } from "@/server/env";
import { HealthNotInstalledError, type HealthPort } from "@/server/privileged/health";
import { EXPECTED_BUCKETS, PROBES } from "./catalogue";
import { handleHealthCron, handleLiveness, handleReadiness } from "./http";
import { reasonOf, runProbes, type ProbeDeps } from "./probes";
import { runHealthRound, type RoundDeps } from "./round";

vi.mock("server-only", () => ({}));

const NOW = new Date("2026-11-20T12:00:00.000Z");
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000).toISOString();
const NO_ENV: HealthEnv = {
  readyToken: null,
  roundSecret: null,
  pingUrl: null,
  github: null,
  vercel: null,
};
const never = () => new Promise<never>(() => {});

function fakePort(over: Partial<HealthPort> = {}): HealthPort {
  return {
    begin: vi.fn(async () => 42),
    record: vi.fn(async () => {}),
    ping: vi.fn(async () => ({ inRecovery: false })),
    cronJobs: vi.fn(async () => ({
      available: true,
      jobs: [
        "catalog-scan-reads-purge",
        "health-samples-purge",
        "sommelier-conversations-purge",
      ].map((name) => ({
        name,
        schedule: name === "health-samples-purge" ? "23 4 * * *" : "*/15 * * * *",
        active: true,
        lastStart: ago(120),
        lastStatus: "succeeded",
        failures24h: 0,
      })),
    })),
    aiWindow: vi.fn(async () => [
      { task: "sommelier_chat", calls: 12, failed: 0, fallback: 0, p95Ms: 2400 },
    ]),
    buckets: vi.fn(async () => [...EXPECTED_BUCKETS]),
    latest: vi.fn(async () => ({ rounds: [], samples: [] })),
    ...over,
  };
}

const okFetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

const deps = (over: Partial<ProbeDeps> = {}): ProbeDeps => ({
  port: fakePort(),
  fetch: okFetch,
  supabaseUrl: "http://stack.test",
  publishableKey: "pk",
  health: NO_ENV,
  now: NOW,
  timeoutMs: 80,
  writeLatencyMs: 20,
  ...over,
});
/** A configuration whose GitHub part throws when read: the CI probe crashes outside its guarded call. */
const BROKEN_ENV = {
  ...NO_ENV,
  get github(): never {
    throw new Error("boom");
  },
} as HealthEnv;
const byId = <T extends { probe: string }>(xs: T[]) => new Map(xs.map((x) => [x.probe, x]));

describe("the probes", () => {
  it("return exactly one measurement per declared probe (the round adds its own)", async () => {
    const got = await runProbes(deps());
    expect(got.map((g) => g.probe)).toEqual(
      PROBES.filter((p) => p.id !== "monitor.round").map((p) => p.id),
    );
  });

  it("measure for real: answering services are healthy; silence and missing config are unknown, never healthy", async () => {
    const got = byId(await runProbes(deps()));
    for (const id of ["db.read", "db.write", "auth.api", "storage.api", "cron.extension"])
      expect(got.get(id), id).toMatchObject({ status: "healthy", reason: "ok" });
    expect(got.get("cron.catalog-scan-reads-purge")).toMatchObject({ status: "healthy" });
    expect(got.get("ai.sommelier_chat")).toMatchObject({
      status: "healthy",
      detail: { calls: 12 },
    });
    // nobody scanned a label this hour: that proves nothing
    expect(got.get("ai.label_extraction")).toMatchObject({
      status: "unknown",
      reason: "no_traffic",
    });
    expect(got.get("delivery.ci")).toMatchObject({ status: "unknown", reason: "not_configured" });
    expect(got.get("delivery.deploy")).toMatchObject({
      status: "unknown",
      reason: "not_configured",
    });
  });

  it("a database that does not answer is failed (timeout) within the probe's limit", async () => {
    const t = Date.now();
    const got = byId(await runProbes(deps({ port: fakePort({ ping: never }) })));
    expect(got.get("db.read")).toMatchObject({ status: "failed", reason: "timeout" });
    expect(Date.now() - t).toBeLessThan(1500);
  });

  it("a slow but answering database is degraded, a standby that cannot write is degraded", async () => {
    let got = byId(await runProbes(deps({ writeLatencyMs: 5000 })));
    expect(got.get("db.write")).toMatchObject({ status: "degraded", reason: "slow" });
    got = byId(
      await runProbes(deps({ port: fakePort({ ping: async () => ({ inRecovery: true }) }) })),
    );
    expect(got.get("db.read")).toMatchObject({ status: "degraded", reason: "in_recovery" });
  });

  it("Auth: an error status or no connection is failed, with a code, never the message", async () => {
    const down = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    let got = byId(await runProbes(deps({ fetch: down as unknown as typeof fetch })));
    expect(got.get("auth.api")).toMatchObject({ status: "failed", reason: "http_502" });
    expect(down).toHaveBeenCalledWith("http://stack.test/auth/v1/health", expect.anything());
    const refused = vi.fn(async () => {
      throw new TypeError("fetch failed: connect ECONNREFUSED 10.1.2.3:443");
    });
    got = byId(await runProbes(deps({ fetch: refused as unknown as typeof fetch })));
    expect(got.get("auth.api")).toMatchObject({ status: "failed", reason: "unreachable" });
    expect(JSON.stringify([...got.values()])).not.toContain("10.1.2.3");
  });

  it("Storage: a missing bucket is failed, a Storage that does not answer is failed", async () => {
    let got = byId(
      await runProbes(deps({ port: fakePort({ buckets: async () => ["bottle-art"] }) })),
    );
    expect(got.get("storage.api")).toMatchObject({
      status: "failed",
      reason: "buckets_missing",
      detail: { buckets: 1, missing: EXPECTED_BUCKETS.length - 1 },
    });
    got = byId(await runProbes(deps({ port: fakePort({ buckets: never }) })));
    expect(got.get("storage.api")).toMatchObject({ status: "failed", reason: "timeout" });
  });

  it("pg_cron: a job that failed, one that is missing, and a scheduler that is not there", async () => {
    const port = fakePort({
      cronJobs: async () => ({
        available: true,
        jobs: [
          {
            name: "catalog-scan-reads-purge",
            schedule: "*/15 * * * *",
            active: true,
            lastStart: ago(60),
            lastStatus: "failed",
            failures24h: 3,
          },
        ],
      }),
    });
    let got = byId(await runProbes(deps({ port })));
    expect(got.get("cron.catalog-scan-reads-purge")).toMatchObject({
      status: "failed",
      reason: "last_run_failed",
      detail: { failures24h: 3, lastRunAgeSec: 60 },
    });
    expect(got.get("cron.sommelier-conversations-purge")).toMatchObject({
      status: "failed",
      reason: "not_scheduled",
    });
    got = byId(
      await runProbes(
        deps({ port: fakePort({ cronJobs: async () => ({ available: false, jobs: [] }) }) }),
      ),
    );
    expect(got.get("cron.extension")).toMatchObject({ status: "unknown", reason: "not_available" });
    expect(got.get("cron.health-samples-purge")?.status).toBe("unknown");
  });

  it("AI: an unreadable usage table is unknown, not healthy", async () => {
    const got = byId(
      await runProbes(
        deps({ port: fakePort({ aiWindow: async () => Promise.reject(new Error("x")) }) }),
      ),
    );
    expect(got.get("ai.all")).toMatchObject({ status: "unknown", reason: "usage_unreadable" });
  });

  it("a probe whose own code crashes is unknown (probe_error), and the others still measure", async () => {
    const got = byId(await runProbes(deps({ health: BROKEN_ENV })));
    expect(got.get("delivery.ci")).toMatchObject({ status: "unknown", reason: "probe_error" });
    expect(got.get("db.read")?.status).toBe("healthy");
  });

  it("GitHub and Vercel: measured only with a token, which never ends up in a sample", async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      expect(new Headers(init?.headers).get("authorization")).toMatch(/^Bearer tok-/);
      if (url.includes("api.github.com"))
        return Response.json({ workflow_runs: [{ status: "completed", conclusion: "failure" }] });
      if (url.includes("api.vercel.com"))
        return Response.json({ deployments: [{ state: "READY" }] });
      return new Response("{}");
    });
    const health: HealthEnv = {
      ...NO_ENV,
      github: { repo: "acme/app", token: "tok-github-secret" },
      vercel: { projectId: "prj_1", teamId: "team_1", token: "tok-vercel-secret" },
    };
    const got = byId(await runProbes(deps({ fetch: f as unknown as typeof fetch, health })));
    expect(got.get("delivery.ci")).toMatchObject({ status: "degraded", reason: "ci_failing" });
    expect(got.get("delivery.deploy")).toMatchObject({ status: "healthy", reason: "ok" });
    expect(
      calls.some((u) =>
        u.startsWith(
          "https://api.github.com/repos/acme/app/actions/workflows/ci.yml/runs?branch=main&status=completed",
        ),
      ),
    ).toBe(true);
    expect(
      calls.some(
        (u) =>
          u.includes("projectId=prj_1") && u.includes("teamId=team_1") && u.includes("state=READY"),
      ),
    ).toBe(true);
    expect(JSON.stringify([...got.values()])).not.toMatch(/tok-/);
  });

  it("a provider that refuses is unknown (we cannot tell), not failed", async () => {
    const f = vi.fn(async (url: string) =>
      url.includes("github") ? new Response("no", { status: 401 }) : new Response("{}"),
    );
    const got = byId(
      await runProbes(
        deps({
          fetch: f as unknown as typeof fetch,
          health: { ...NO_ENV, github: { repo: "acme/app", token: "t" } },
        }),
      ),
    );
    expect(got.get("delivery.ci")).toMatchObject({
      status: "unknown",
      reason: "provider_http_401",
    });
  });

  it("an error becomes a code, never its message", () => {
    expect(reasonOf(new Error("password authentication failed for user postgres"))).toBe("error");
    expect(reasonOf(Object.assign(new Error("x"), { code: "PGRST301" }))).toBe("rpc_pgrst301");
    expect(reasonOf(Object.assign(new Error("x"), { code: "a very long code with spaces" }))).toBe(
      "error",
    );
    expect(reasonOf(new DOMException("t", "TimeoutError"))).toBe("timeout");
  });
});

const roundDeps = (over: Partial<RoundDeps> = {}): Partial<RoundDeps> => ({
  port: fakePort(),
  fetch: okFetch,
  supabaseUrl: "http://stack.test",
  publishableKey: "pk",
  health: NO_ENV,
  now: () => NOW,
  timeoutMs: 80,
  minGapSec: 60,
  ...over,
});

describe("a round", () => {
  it("records the monitor's own sample and every probe, in one call", async () => {
    const port = fakePort();
    const r = await runHealthRound("heartbeat", roundDeps({ port }));
    expect(r).toEqual({ kind: "recorded", round: 42, outcome: "ok", failedInfrastructure: 0 });
    expect(port.begin).toHaveBeenCalledWith("heartbeat", 60);
    const [round, outcome, samples] = vi.mocked(port.record).mock.calls[0]!;
    expect(round).toBe(42);
    expect(outcome).toBe("ok");
    expect(samples.map((s) => s.probe).sort()).toEqual(PROBES.map((p) => p.id).sort());
    expect(samples.find((s) => s.probe === "monitor.round")).toMatchObject({ status: "healthy" });
  });

  it("counts failed infrastructure checks, which is what the heartbeat alarms on", async () => {
    const port = fakePort({ ping: never, buckets: never });
    const r = await runHealthRound("heartbeat", roundDeps({ port }));
    expect(r).toMatchObject({ kind: "recorded", failedInfrastructure: 2 });
  });

  it("a crashed probe makes the round partial", async () => {
    const r = await runHealthRound("heartbeat", roundDeps({ health: BROKEN_ENV }));
    expect(r).toMatchObject({ kind: "recorded", outcome: "partial" });
  });

  it("is skipped when one ran less than a minute ago (bounded cost)", async () => {
    const port = fakePort({ begin: vi.fn(async () => null) });
    expect(await runHealthRound("heartbeat", roundDeps({ port }))).toEqual({
      kind: "skipped",
      failedInfrastructure: 0,
    });
    expect(port.ping).not.toHaveBeenCalled();
    expect(port.record).not.toHaveBeenCalled();
  });

  it("without the service role, without the migration, or without a database it records nothing and says so", async () => {
    expect(await runHealthRound("heartbeat", roundDeps({ port: null }))).toEqual({
      kind: "not_configured",
    });
    const notInstalled = fakePort({
      begin: async () => Promise.reject(new HealthNotInstalledError()),
    });
    expect(await runHealthRound("heartbeat", roundDeps({ port: notInstalled }))).toEqual({
      kind: "not_installed",
    });
    expect(
      await runHealthRound("heartbeat", roundDeps({ port: fakePort({ begin: never }) })),
    ).toEqual({
      kind: "database_unreachable",
      reason: "timeout",
    });
  });

  it("a failed write of the results is reported, not hidden", async () => {
    const port = fakePort({ record: async () => Promise.reject(new TypeError("fetch failed")) });
    expect(await runHealthRound("heartbeat", roundDeps({ port }))).toEqual({
      kind: "record_failed",
      reason: "unreachable",
    });
  });

  it("calls the dead man's switch after a recorded round; its failure changes nothing", async () => {
    const f = vi.fn(async (url: string) => {
      if (url === "https://hc.example/ping/abc") throw new TypeError("down");
      return new Response("{}");
    });
    const r = await runHealthRound(
      "heartbeat",
      roundDeps({
        fetch: f as unknown as typeof fetch,
        health: { ...NO_ENV, pingUrl: "https://hc.example/ping/abc" },
      }),
    );
    expect(r.kind).toBe("recorded");
    expect(f).toHaveBeenCalledWith("https://hc.example/ping/abc", expect.anything());
  });

  it("never calls the dead man's switch when nothing was recorded", async () => {
    const f = vi.fn(async () => new Response("{}"));
    await runHealthRound(
      "heartbeat",
      roundDeps({
        port: fakePort({ begin: vi.fn(async () => null) }),
        fetch: f as unknown as typeof fetch,
        health: { ...NO_ENV, pingUrl: "https://hc.example/ping/abc" },
      }),
    );
    expect(f).not.toHaveBeenCalled();
  });
});

describe("the endpoints", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_localstack_0000000000";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.CRON_SECRET;
    delete process.env.CELLR_HEALTH_ROUND_SECRET;
    delete process.env.CELLR_HEALTH_READY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...saved };
  });
  const get = (path: string, auth?: string) =>
    new Request(`http://app.test${path}`, auth ? { headers: { authorization: auth } } : {});

  it("liveness says ok and nothing else, uncached", async () => {
    const res = handleLiveness();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("the probe round needs CRON_SECRET; a wrong one is refused in constant time", async () => {
    expect((await handleHealthCron(get("/api/cron/health"))).status).toBe(503);
    process.env.CRON_SECRET = "short-secret";
    // a secret too short to guard anything counts as not set
    expect((await handleHealthCron(get("/api/cron/health", "Bearer short-secret"))).status).toBe(
      503,
    );
    process.env.CRON_SECRET = "s3cret-value-long-enough";
    expect((await handleHealthCron(get("/api/cron/health"))).status).toBe(401);
    expect((await handleHealthCron(get("/api/cron/health", "Bearer wrong"))).status).toBe(401);
    // the right secret, no service role here: nothing can be recorded, and the answer says only that
    const res = await handleHealthCron(get("/api/cron/health", "Bearer s3cret-value-long-enough"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, recorded: false, reason: "not_configured" });
  });

  it("a dedicated round secret is preferred: the shared CRON_SECRET then no longer starts a round", async () => {
    process.env.CRON_SECRET = "shared-cron-secret-0001";
    process.env.CELLR_HEALTH_ROUND_SECRET = "dedicated-round-secret-01";
    expect(
      (await handleHealthCron(get("/api/cron/health", "Bearer shared-cron-secret-0001"))).status,
    ).toBe(401);
    // the right one passes the check (and then finds no service role here)
    expect(
      (await handleHealthCron(get("/api/cron/health", "Bearer dedicated-round-secret-01"))).status,
    ).toBe(503);
    // a short dedicated secret does not count: CRON_SECRET is used again
    process.env.CELLR_HEALTH_ROUND_SECRET = "short";
    expect(
      (await handleHealthCron(get("/api/cron/health", "Bearer shared-cron-secret-0001"))).status,
    ).toBe(503);
  });

  it("readiness is not there without a token (404), and a short token does not count", async () => {
    expect((await handleReadiness(get("/api/health/ready"))).status).toBe(404);
    process.env.CELLR_HEALTH_READY_TOKEN = "short";
    expect((await handleReadiness(get("/api/health/ready", "Bearer short"))).status).toBe(404);
    process.env.CELLR_HEALTH_READY_TOKEN = "a-long-enough-ready-token-123";
    expect((await handleReadiness(get("/api/health/ready", "Bearer nope"))).status).toBe(401);
    const res = await handleReadiness(
      get("/api/health/ready", "Bearer a-long-enough-ready-token-123"),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unknown", monitor: "not_configured" });
  });
});

describe("a skipped round never hides a failure", () => {
  it("reports what the round that ran instead found", async () => {
    const port = fakePort({
      begin: vi.fn(async () => null),
      latest: async () => ({
        rounds: [
          { id: 7, trigger: "manual", startedAt: ago(30), finishedAt: ago(29), outcome: "ok" },
        ],
        samples: [
          {
            probe: "db.read",
            status: "failed",
            reason: "timeout",
            latencyMs: 3000,
            detail: {},
            measuredAt: ago(29),
          },
          {
            probe: "auth.api",
            status: "failed",
            reason: "http_503",
            latencyMs: 5,
            detail: {},
            measuredAt: ago(29),
          },
          {
            probe: "storage.api",
            status: "healthy",
            reason: "ok",
            latencyMs: 5,
            detail: {},
            measuredAt: ago(29),
          },
        ],
      }),
    });
    expect(await runHealthRound("heartbeat", roundDeps({ port }))).toEqual({
      kind: "skipped",
      failedInfrastructure: 2,
    });
  });
});
