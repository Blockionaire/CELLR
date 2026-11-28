import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GATE_PROPOSAL, KINDS, levelReport, summaryLine, type Sample } from "./ladder-lib";
import { verdict } from "./ladder";

/**
 * staging-pilot.sh perf-ladder END TO END: the real script with its real trap, perf16-lib.sh's state read,
 * ladder.ts judge and redact-results.ts; only `psql` and `pnpm` are stubs on the PATH (test-stubs/ladder): psql
 * answers only the two reads the mode may send (anything else fails the run), pnpm hands ladder.ts run's reports
 * from files built by the real report code. What is required: the mode is READ-ONLY (no provider switched, nothing
 * written), a failed search or a concurrency not reached FAILS the run, the proposed gate never does, and only
 * counts and timings leave the run.
 */
const here = fileURLToPath(new URL(".", import.meta.url));

/** A level as ladder.ts reports it: `level` clients in a closed loop, each search `ms` long, `errors` failed. */
function level(n: number, ms: number, o: { errors?: number; lanes?: number } = {}) {
  const lanes = o.lanes ?? n;
  const per = Math.ceil(Math.max(1000, 1600) / lanes);
  const samples: Sample[] = [];
  for (let lane = 0; lane < lanes; lane++)
    for (let i = 0; i < per; i++)
      samples.push({
        kind: KINDS[i % 7]!,
        repeat: i % 10 < 3 ? "hot" : "unique",
        ok: true,
        start: i * ms,
        end: i * ms + ms,
        pid: 10 + lane,
        rows: 8,
        clientMs: ms + 150,
      });
  for (let i = 0; i < (o.errors ?? 0); i++)
    samples.push({ kind: "full", repeat: "unique", ok: false, code: "57014" });
  return levelReport({
    level: n,
    clients: n,
    batch: 50,
    seconds: 60,
    warmup: 150,
    warmupErrors: 0,
    samples,
    overheads: [150],
    sampler: null,
    resources: null,
    householdsUsed: 201,
    clientCpuMs: 300,
  });
}

function run(levels: ReturnType<typeof level>[], env: Record<string, string> = {}) {
  const h = mkdtempSync(join(tmpdir(), "ladder-e2e-"));
  mkdirSync(join(h, "run"));
  for (const l of levels)
    writeFileSync(join(h, "run", `ladder-c${l.level}.json`), JSON.stringify(l));
  const lines = levels.map(summaryLine);
  writeFileSync(
    join(h, "run", "ladder-summary.json"),
    JSON.stringify({ levels: lines, ...verdict(lines, GATE_PROPOSAL) }),
  );
  const out = join(h, "out");
  const r = spawnSync("bash", [join(here, "staging-pilot.sh"), "perf-ladder", out], {
    cwd: here,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(here, "test-stubs/ladder")}:${process.env.PATH}`,
      H: h,
      STAGING_DB_URL: "postgres://stub",
      STAGING_PROJECT_REF: "stubref",
      CONFIRM_REF: "stubref",
      ...env,
    },
  });
  const read = (f: string) => (existsSync(join(h, f)) ? readFileSync(join(h, f), "utf8") : "");
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    psql: read("psql.log"),
    calls: read("calls.log"),
    files: existsSync(out) ? readdirSync(out).sort() : [],
    out,
  };
}

const valid = () => [level(1, 40), level(2, 45), level(4, 90), level(8, 180), level(16, 360)];

describe("staging-pilot.sh perf-ladder, end to end", { timeout: 120_000 }, () => {
  it("a valid measurement passes; the gate is reported as a proposal", () => {
    const r = run(valid());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("ladder measurement: VALID");
    expect(r.stdout).toContain(
      "release gate (proposal): SQL p95 < 250 ms at 4 concurrent; at 8 reported: MET",
    );
    expect(r.stdout).toContain("not enforced");
    expect(r.stdout).toContain("• state unchanged");
    expect(r.stdout).toMatch(/• c16: \{"clients":16/);
  });
  it("is READ-ONLY: only the state read and one count go to the database, no provider tool, no import, no seed", () => {
    const r = run(valid());
    expect(r.status, r.stderr).toBe(0);
    const statements = r.psql.trim().split("\n");
    expect(statements).toHaveLength(3); // the X-Wines count, the state before, the state after
    for (const s of statements)
      expect(s).toMatch(
        /perf16-state\.sql|select count\(\*\) from public\.catalog_external_records/,
      );
    expect(r.psql).not.toMatch(
      /admin_catalog_provider|perf-synthetic\.sql|seed-load\.sql|insert |update |delete /i,
    );
    expect(r.calls).not.toMatch(/provider\.ts|import\.ts|ratings\.ts|perf\.ts /);
    expect(r.calls).toMatch(/tsx ladder\.ts run .*--path pilot/);
    expect(r.calls).toMatch(/tsx ladder\.ts judge --summary/);
  });
  it("a failed search fails the run (fail-closed), after the results are kept", () => {
    const l = valid();
    l[2] = level(4, 90, { errors: 3 });
    const r = run(l);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FAIL c4: no search failed (warm-up included)");
    expect(r.stdout).toContain("ladder measurement: NOT VALID");
    expect(r.files).toContain("ladder-summary.json");
  });
  it("the concurrency not reached in PostgreSQL fails the run", () => {
    const l = valid();
    l[3] = level(8, 180, { lanes: 3 });
    const r = run(l);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("FAIL c8: 8 executing in PostgreSQL at once");
  });
  it("the proposed gate not met does NOT fail the run (reported only)", () => {
    const r = run([level(1, 100), level(2, 200), level(4, 400), level(8, 800), level(16, 1600)]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("at 8 reported: NOT MET");
  });
  it("ladder.ts run failing without a summary fails the run", () => {
    const r = run(valid(), { LADDER_CRASH: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("the ladder wrote no summary");
  });
  it("ladder.ts run exiting 1 (its own measurement verdict) fails the run even when the judge would pass", () => {
    const r = run(valid(), { LADDER_RC: "1" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ladder.ts exited 1");
  });
  it("a state that changed during the run fails it", () => {
    const r = run(valid(), { WINES_AFTER: "10301" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("the state changed during a read-only run");
  });
  it("refused before measuring: X-Wines not pilot, the synthetic source public, or X-Wines not imported", () => {
    for (const env of [{ XWINES: "public" }, { SYNTH: "public" }, { XWINES_RECORDS: "0" }]) {
      const r = run(valid(), env);
      expect(r.status, JSON.stringify(env)).not.toBe(0);
      expect(r.calls).not.toContain("tsx ladder.ts run");
    }
  });
  it("only counts and timings leave the run: known files kept, anything else deleted", () => {
    const r = run(valid());
    expect(r.files).toEqual([
      "ladder-c1.json",
      "ladder-c16.json",
      "ladder-c2.json",
      "ladder-c4.json",
      "ladder-c8.json",
      "ladder-state-after.json",
      "ladder-state-before.json",
      "ladder-summary.json",
      "pool-probe.json",
      "staging-check-after.json",
      "staging-check-before.json",
    ]);
    expect(r.stdout + r.stderr).not.toContain("a real wine name");
    for (const f of r.files)
      expect(readFileSync(join(r.out, f), "utf8")).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/,
      );
  });
});
