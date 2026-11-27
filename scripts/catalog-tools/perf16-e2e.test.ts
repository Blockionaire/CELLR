import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { judgePerf, measuredFields, type PerfReport } from "./perf-accept";

/**
 * staging-pilot.sh perf16 and perf16-cleanup run END TO END, the real script with its real trap, perf16-lib.sh,
 * perf-accept.ts and redact-results.ts; only `psql` and `pnpm` are stubs on the PATH (test-stubs/perf16): psql
 * answers as a staging database reduced to the synthetic source's scope, pnpm hands perf.ts's report from a file.
 * What the owner required: the run FAILS when the acceptance is not met, and whatever happens the synthetic source
 * ends switched off, with the failure kept and the recovery printed when that cannot be done.
 */
const here = fileURLToPath(new URL(".", import.meta.url));

/** A perf.ts report built by the real measuredFields: `lanes` searches executing at once, each `ms` long. */
function report(lanes: number, ms: number, over: Partial<PerfReport> = {}): PerfReport {
  const intervals = Array.from({ length: lanes * 40 }, (_, k) => {
    const lane = k % lanes;
    const i = Math.floor(k / lanes);
    return { start: i * ms, end: i * ms + ms, pid: 1000 + lane };
  });
  const n = intervals.length;
  return {
    mode: "public",
    synthetic: "perf_synth",
    timing: "database (clock_timestamp around the search), one round trip per search",
    searches: n,
    overall: { n, p50: ms, p95: ms, p99: ms, empty: 0 },
    ...measuredFields(intervals, 16, n, { samples: 300, max_active: lanes, mean_active: lanes }),
    ...over,
  };
}

function run(mode: "perf16" | "perf16-cleanup", c16: PerfReport, env: Record<string, string> = {}) {
  const h = mkdtempSync(join(tmpdir(), "perf16-e2e-"));
  writeFileSync(join(h, "scope"), env.START_SCOPE ?? "absent");
  writeFileSync(join(h, "c16.json"), JSON.stringify(c16));
  writeFileSync(join(h, "c1.json"), JSON.stringify(report(1, 30)));
  const r = spawnSync("bash", [join(here, "staging-pilot.sh"), mode, join(h, "out")], {
    cwd: here,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(here, "test-stubs/perf16")}:${process.env.PATH}`,
      H: h,
      STAGING_DB_URL: "postgres://stub",
      STAGING_PROJECT_REF: "stubref",
      CONFIRM_REF: "stubref",
      PERF16_RETRY_SECONDS: "0",
      ...env,
    },
  });
  const calls = existsSync(join(h, "calls.log")) ? readFileSync(join(h, "calls.log"), "utf8") : "";
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    scope: readFileSync(join(h, "scope"), "utf8").trim(),
    disables: calls.split("\n").filter((l) => l.includes("admin_catalog_provider_disable")).length,
    accept: calls.includes("tsx perf-accept.ts --report"),
  };
}

const met = () => report(18, 120);

describe("the fixtures are what they claim (judged by the real acceptance)", () => {
  it("18 lanes of 120 ms meet it; 15 lanes (a capped pool) do not", () => {
    expect(judgePerf(met()).filter((c) => !c.ok)).toEqual([]);
    expect(judgePerf(report(15, 120)).some((c) => !c.ok)).toBe(true);
  });
});

describe("staging-pilot.sh perf16, end to end", { timeout: 120_000 }, () => {
  it("a run that meets the acceptance passes, and the source ends switched off", () => {
    const r = run("perf16", met());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("perf16 acceptance: MET");
    expect(r.stdout).toContain("perf16 cleanup: CLEAN");
    expect(r.scope).toBe("off");
    expect(r.disables).toBe(1);
  });
  it("p95 above 250 ms at 16 concurrent: the run fails, the source still ends off", () => {
    const r = run("perf16", report(18, 400));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("perf16 acceptance: NOT MET");
    expect(r.scope).toBe("off");
  });
  it("only 15 executing at once (a pool of 15): the run fails, the source ends off", () => {
    const r = run("perf16", report(15, 120));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FAIL concurrency: 16 searches executing in PostgreSQL at once");
    expect(r.scope).toBe("off");
  });
  it("perf.ts crashing: the run fails before any acceptance, the source ends off", () => {
    const r = run("perf16", met(), { PERF_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.accept).toBe(false);
    expect(r.scope).toBe("off");
  });
  it("the synthetic import failing: the run fails; nothing was made public, nothing to switch off", () => {
    const r = run("perf16", met(), { SYNTH_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.scope).toBe("absent");
    expect(r.disables).toBe(0);
  });
  it("the independent check not seeing the public source: the run fails (its later '0 found' would prove nothing)", () => {
    const r = run("perf16", met(), { SEEN_WHILE_PUBLIC: "0" });
    expect(r.status).not.toBe(0);
    expect(r.accept).toBe(false);
    expect(r.scope).toBe("off");
  });
  it("a pool that cannot run 16 at once: the gate stops the run before anything is made public", () => {
    const r = run("perf16", met(), { POOL_PEAK: "15" });
    expect(r.status).not.toBe(0);
    expect(r.accept).toBe(false);
    expect(r.scope).toBe("absent");
    expect(r.disables).toBe(0);
  });
  it("X-Wines not pilot: refused before anything is made public", () => {
    const r = run("perf16", met(), { XWINES: "public" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("X-Wines is not in pilot scope");
    expect(r.scope).toBe("absent");
  });
  it("the switch-off failing twice: retried, the run still passes", () => {
    const r = run("perf16", met(), { DISABLE_FAILS: "2" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.disables).toBe(3);
    expect(r.stderr).toContain("simulated denial");
  });
  it("the switch-off failing three times: the run FAILS even though the acceptance was met, and says how to recover", () => {
    const r = run("perf16", met(), { DISABLE_FAILS: "3" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("perf16 acceptance: MET");
    expect(r.disables).toBe(3);
    expect(r.scope).toBe("public");
    expect(r.stderr).toContain("RECOVERY");
    expect(r.stderr).toContain("perf16-cleanup");
  });
});

describe("staging-pilot.sh perf16-cleanup (recovery), end to end", { timeout: 60_000 }, () => {
  it("switches a source left public off and checks it", () => {
    const r = run("perf16-cleanup", met(), { START_SCOPE: "public" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.scope).toBe("off");
    expect(r.stdout).toContain("perf16 cleanup: CLEAN");
  });
  it("an unreadable state does not stop the switch-off, and the run still fails (nothing to compare)", () => {
    const r = run("perf16-cleanup", met(), { START_SCOPE: "public", STATE_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.disables).toBe(1);
    expect(r.scope).toBe("off");
    expect(r.stderr).toContain("RECOVERY");
  });
});
