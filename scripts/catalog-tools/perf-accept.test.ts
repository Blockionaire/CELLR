import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACCEPT,
  concurrencyOf,
  judgeCleanup,
  judgePerf,
  measuredFields,
  overlapOf,
  type Perf16State,
  type PerfReport,
} from "./perf-accept";

const here = fileURLToPath(new URL(".", import.meta.url));

describe("concurrency measured from the searches' server-side intervals", () => {
  it("16 searches over the same 100 ms: 16 at once for the whole window", () => {
    const c = concurrencyOf(
      Array.from({ length: 16 }, () => ({ start: 1000, end: 1100 })),
      16,
    );
    expect(c).toMatchObject({ peak: 16, mean: 16, median: 16, share_at_target: 1, window_ms: 100 });
  });
  it("16 searches one after another: never more than 1, whatever the number of clients", () => {
    const c = concurrencyOf(
      Array.from({ length: 16 }, (_, i) => ({ start: i * 100, end: i * 100 + 100 })),
      16,
    );
    expect(c).toMatchObject({
      peak: 1,
      mean: 1,
      median: 1,
      share_at_target: 0,
      steady_share_at_target: 0,
    });
  });
  it("intervals that only touch do not overlap", () => {
    expect(
      concurrencyOf(
        [
          { start: 0, end: 10 },
          { start: 10, end: 20 },
        ],
        2,
      ).peak,
    ).toBe(1);
  });
  it("16 at once for a quarter of the window: the peak alone would mislead, the share says 25%", () => {
    const burst = Array.from({ length: 16 }, () => ({ start: 0, end: 100 }));
    const c = concurrencyOf([...burst, { start: 100, end: 400 }], 16);
    expect(c.peak).toBe(16);
    expect(c.share_at_target).toBe(0.25);
    expect(c.median).toBe(1);
    expect(c.mean).toBeCloseTo((16 * 100 + 300) / 400, 2);
  });
  it("the steady state leaves the ramp-up and ramp-down out", () => {
    // 16 at once from 10 to 90 of a 0..100 window, one search at each end: the steady state (10..90) is all at 16
    const sixteen = Array.from({ length: 16 }, () => ({ start: 10, end: 90 }));
    const c = concurrencyOf([{ start: 0, end: 10 }, ...sixteen, { start: 90, end: 100 }], 16);
    expect(c.share_at_target).toBe(0.8);
    expect(c.steady_share_at_target).toBe(1);
  });
  it("each search's own overlap: alone 1, with 15 others for its whole span 16, half-overlapped 1.5", () => {
    expect(
      overlapOf(Array.from({ length: 16 }, () => ({ start: 0, end: 100 }))).every((o) => o === 16),
    ).toBe(true);
    expect(overlapOf([{ start: 0, end: 100 }])).toEqual([1]);
    expect(
      overlapOf([
        { start: 0, end: 100 },
        { start: 50, end: 150 },
      ]),
    ).toEqual([1.5, 1.5]);
    expect(Number.isNaN(overlapOf([{ start: 5, end: 1 }])[0])).toBe(true);
  });
  it("broken or missing timestamps are not counted; nothing measured is zero", () => {
    expect(
      concurrencyOf(
        [
          { start: NaN, end: 5 },
          { start: 9, end: 3 },
        ],
        16,
      ).peak,
    ).toBe(0);
    expect(concurrencyOf([], 16)).toMatchObject({ peak: 0, share_at_target: 0, window_ms: 0 });
  });
});

const good = (): PerfReport => ({
  mode: "public",
  synthetic: "perf_synth",
  timing: "database (clock_timestamp around the search), one round trip per search",
  searches: 5400,
  overall: { n: 5400, p50: 60, p95: 180, p99: 230, empty: 300 },
  latency_at_target: { n: 4800, p50: 70, p95: 190, p99: 240 },
  synthetic_hits: 4900,
  database_concurrency: {
    window_ms: 30000,
    peak: 17,
    mean: 15.8,
    median: 16,
    share_at_target: 0.81,
    steady_share_at_target: 0.9,
    target: 16,
    backends: 17,
  },
  activity_sampler: { samples: 600, max_active: 16, mean_active: 14.9 },
});
const failing = (r: PerfReport) =>
  judgePerf(r)
    .filter((c) => !c.ok)
    .map((c) => c.name);
const P95 =
  "latency: database p95 under 250 ms, over the searches that ran with 16 or more executing";
const AT16 =
  "concurrency: 16 searches executing in PostgreSQL at once, for at least 80% of the steady state";

describe("perf16 acceptance is fail-closed", () => {
  it("a run that meets every criterion passes", () => {
    expect(failing(good())).toEqual([]);
  });
  it("p95 at or above 250 ms at the target concurrency fails; a missing or non-number p95 fails", () => {
    const at = good().latency_at_target!;
    expect(failing({ ...good(), latency_at_target: { ...at, p95: 250 } })).toEqual([P95]);
    expect(failing({ ...good(), latency_at_target: { ...at, p95: NaN } })).toEqual([P95]);
    expect(failing({ ...good(), latency_at_target: { n: 4800 } })).toEqual([P95]);
  });
  it("a fast overall p95 does not hide a slow p95 at 16 concurrent (the overall figure is not what is judged)", () => {
    const r = {
      ...good(),
      overall: { ...good().overall, p95: 90 },
      latency_at_target: { n: 4800, p95: 310 },
    };
    expect(failing(r)).toEqual([P95]);
  });
  it("too few searches ran at the target concurrency to judge their p95", () => {
    expect(failing({ ...good(), latency_at_target: { n: 120, p95: 100 } })).toEqual([P95]);
  });
  it("16 clients but only ~6 searches executing in PostgreSQL fails (the old throughput × latency reading)", () => {
    const dc = {
      ...good().database_concurrency!,
      peak: 9,
      median: 6,
      mean: 6.1,
      share_at_target: 0,
      steady_share_at_target: 0,
    };
    expect(failing({ ...good(), database_concurrency: dc })).toEqual([AT16]);
  });
  it("a pool capped at 15 connections fails: the peak, the backends and the sampler stay below 16", () => {
    const dc = {
      ...good().database_concurrency!,
      peak: 15,
      median: 15,
      mean: 14.6,
      share_at_target: 0,
      steady_share_at_target: 0,
      backends: 15,
    };
    const sampler = { samples: 600, max_active: 15, mean_active: 14 };
    expect(failing({ ...good(), database_concurrency: dc, activity_sampler: sampler })).toEqual([
      AT16,
      "concurrency: on at least 16 distinct backends",
      "concurrency: pg_stat_activity saw 16 active searches",
    ]);
  });
  it("a brief burst of 16 (peak only) is not enough", () => {
    const dc = {
      ...good().database_concurrency!,
      share_at_target: 0.1,
      steady_share_at_target: 0.1,
    };
    expect(failing({ ...good(), database_concurrency: dc })).toEqual([AT16]);
  });
  it("no concurrency measurement, or no sampler, fails", () => {
    const noDc: PerfReport = { ...good() };
    delete noDc.database_concurrency;
    expect(failing(noDc)).toEqual(
      expect.arrayContaining([AT16, "concurrency: on at least 16 distinct backends"]),
    );
    expect(failing({ ...good(), activity_sampler: null })).toEqual([
      "concurrency: pg_stat_activity saw 16 active searches",
    ]);
  });
  it("mostly empty results, or a synthetic source that is not reached, fails", () => {
    expect(failing({ ...good(), overall: { ...good().overall, empty: 2000 } })).toEqual([
      "results: at most 20% of searches empty",
    ]);
    expect(failing({ ...good(), synthetic_hits: 12 })).toEqual([
      "results: the synthetic public source answers at least 70% of searches",
    ]);
    expect(failing({ ...good(), synthetic: null })).toHaveLength(1);
  });
  it("a pilot-mode, client-timed or too small run proves nothing", () => {
    expect(failing({ ...good(), mode: "pilot" })).toHaveLength(1);
    expect(failing({ ...good(), timing: "client" })).toHaveLength(1);
    expect(failing({ ...good(), searches: 100, overall: { ...good().overall, n: 100 } })).toEqual(
      expect.arrayContaining([`measured: at least ${ACCEPT.min_searches} searches`]),
    );
  });
  it("boundaries: exactly at each threshold passes, just past it fails", () => {
    const dc = good().database_concurrency!;
    const at = good().latency_at_target!;
    expect(failing({ ...good(), latency_at_target: { ...at, n: 500 } })).toEqual([]);
    expect(failing({ ...good(), latency_at_target: { ...at, n: 499 } })).toEqual([P95]);
    expect(
      failing({ ...good(), database_concurrency: { ...dc, steady_share_at_target: 0.8 } }),
    ).toEqual([]);
    expect(
      failing({ ...good(), database_concurrency: { ...dc, steady_share_at_target: 0.79 } }),
    ).toEqual([AT16]);
    expect(failing({ ...good(), database_concurrency: { ...dc, backends: 16 } })).toEqual([]);
    expect(failing({ ...good(), database_concurrency: { ...dc, backends: 15 } })).toEqual([
      "concurrency: on at least 16 distinct backends",
    ]);
    expect(failing({ ...good(), overall: { ...good().overall, empty: 1080 } })).toEqual([]); // 20% of 5400
    expect(failing({ ...good(), overall: { ...good().overall, empty: 1081 } })).toHaveLength(1);
    expect(failing({ ...good(), synthetic_hits: 3780 })).toEqual([]); // 70% of 5400
    expect(failing({ ...good(), synthetic_hits: 3779 })).toHaveLength(1);
    expect(
      failing({ ...good(), activity_sampler: { samples: 600, max_active: 15, mean_active: 14 } }),
    ).toHaveLength(1);
  });
  it("a measurement made for another target, or a report whose searches and samples disagree, fails", () => {
    expect(
      failing({ ...good(), database_concurrency: { ...good().database_concurrency!, target: 8 } }),
    ).toEqual([AT16]);
    expect(failing({ ...good(), searches: 5401 })).toEqual([
      `measured: at least ${ACCEPT.min_searches} searches`,
    ]);
  });
  it("the median over time: half the window at 16, half at 1, is 1 (the lower half), never rounded up", () => {
    const c = concurrencyOf(
      [...Array.from({ length: 16 }, () => ({ start: 0, end: 100 })), { start: 100, end: 200 }],
      16,
    );
    expect(c.median).toBe(1);
    expect(c.share_at_target).toBe(0.5);
  });
  it("measuredFields → judgePerf: the fields perf.ts reports are the fields the acceptance judges", () => {
    const lanes = (k: number, ms: number) =>
      Array.from({ length: k * 40 }, (_, i) => ({
        start: Math.floor(i / k) * ms,
        end: Math.floor(i / k) * ms + ms,
        pid: i % k,
      }));
    const base = { mode: "public", synthetic: "perf_synth", timing: "database (clock_timestamp)" };
    const r18 = measuredFields(lanes(18, 120), 16, 720, {
      samples: 9,
      max_active: 18,
      mean_active: 18,
    });
    expect(r18.database_concurrency.peak).toBe(18);
    expect(r18.latency_at_target).toMatchObject({ n: 720, p95: 120 });
    expect(
      judgePerf({ ...base, searches: 720, overall: { n: 720, p95: 120, empty: 0 }, ...r18 }).filter(
        (c) => !c.ok,
      ),
    ).toEqual([]);
    const r15 = measuredFields(lanes(15, 120), 16, 600, {
      samples: 9,
      max_active: 15,
      mean_active: 15,
    });
    expect(r15.latency_at_target.n).toBe(0);
    expect(
      judgePerf({ ...base, searches: 600, overall: { n: 600, p95: 120, empty: 0 }, ...r15 }).some(
        (c) => !c.ok,
      ),
    ).toBe(true);
  });
  it("an empty report fails every check", () => {
    expect(judgePerf({}).every((c) => !c.ok)).toBe(true);
  });
});

const state = (over: Partial<Perf16State> = {}): Perf16State => ({
  xwines_scope: "pilot",
  synth_scope: "off",
  synth_records: 100000,
  person_sees_synth: 0,
  users: 1,
  households: 201,
  wines: 10300,
  ...over,
});
const dirty = (b: Perf16State, a: Perf16State) =>
  judgeCleanup(b, a)
    .filter((c) => !c.ok)
    .map((c) => c.name);

describe("perf16 cleanup check", () => {
  const before = state({ synth_scope: null, synth_records: 0 });
  it("off, found by no one, X-Wines pilot, nothing else changed: clean", () => {
    expect(dirty(before, state())).toEqual([]);
    expect(dirty(before, state({ synth_scope: null }))).toEqual([]);
  });
  it("a source still public or still found by a person is not clean", () => {
    expect(dirty(before, state({ synth_scope: "public" }))).toEqual([
      "cleanup: the synthetic source is off",
    ]);
    expect(dirty(before, state({ synth_scope: "pilot" }))).toEqual([
      "cleanup: the synthetic source is off",
    ]);
    expect(dirty(before, state({ person_sees_synth: 3 }))).toEqual([
      "cleanup: a person's search finds no synthetic record",
    ]);
  });
  it("X-Wines not pilot before or after is not clean", () => {
    expect(dirty(before, state({ xwines_scope: "public" }))).toEqual([
      "cleanup: X-Wines stayed pilot",
    ]);
    expect(dirty(state({ xwines_scope: "off" }), state())).toEqual([
      "cleanup: X-Wines stayed pilot",
    ]);
  });
  it("a person, household or wine added or removed is not clean", () => {
    expect(dirty(before, state({ users: 2 }))).toEqual(["cleanup: no user touched"]);
    expect(dirty(before, state({ households: 200 }))).toEqual(["cleanup: no household touched"]);
    expect(dirty(before, state({ wines: 10301 }))).toEqual(["cleanup: no wine touched"]);
  });
});

describe("the commands staging-pilot.sh runs (exit codes)", { timeout: 60_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "perf-accept-"));
  const tsx = (...a: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", "perf-accept.ts", ...a], {
      cwd: here,
      encoding: "utf8",
    });
  const put = (name: string, data: unknown) => {
    writeFileSync(join(dir, name), JSON.stringify(data));
    return join(dir, name);
  };
  it("acceptance: 0 when met, 1 when not, and the report says which check failed", () => {
    expect(tsx("--report", put("ok.json", good())).status).toBe(0);
    const out = join(dir, "accept.json");
    const r = tsx(
      "--report",
      put("slow.json", { ...good(), latency_at_target: { n: 4800, p95: 400 } }),
      "--out",
      out,
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      "FAIL latency: database p95 under 250 ms, over the searches that ran with 16",
    );
    expect(r.stdout).toContain("NOT MET");
    expect(JSON.parse(readFileSync(out, "utf8")).ok).toBe(false);
  });
  it("cleanup: 0 when clean, 1 when the source is still public", () => {
    const b = put("before.json", state({ synth_scope: null }));
    expect(tsx("cleanup", "--before", b, "--after", put("a1.json", state())).status).toBe(0);
    const r = tsx(
      "cleanup",
      "--before",
      b,
      "--after",
      put("a2.json", state({ synth_scope: "public" })),
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("NOT CLEAN");
  });
});
