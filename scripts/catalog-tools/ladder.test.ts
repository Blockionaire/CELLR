import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  autoBatch,
  buildMix,
  GATE_PROPOSAL,
  HOT_SIZE,
  judgeGate,
  KINDS,
  levelReport,
  measurementChecks,
  messageSql,
  MIX,
  parseMessage,
  quotas,
  summaryLine,
  typed,
  typo,
  variant,
  type LevelInput,
  type Sample,
  type Search,
  type Source,
} from "./ladder-lib";

const here = fileURLToPath(new URL(".", import.meta.url));

/** Invented wines (no dataset record): enough distinct producers and names for every kind. */
const words = [
  "alder",
  "birch",
  "cedar",
  "delta",
  "ember",
  "fjord",
  "grove",
  "heath",
  "inlet",
  "juniper",
];
/** An invented syllable per number: distinct first letters, as real producer names have. */
const syl = (i: number) =>
  [i % 26, Math.floor(i / 26) % 26, Math.floor(i / 676) % 26, Math.floor(i / 17576) % 26]
    .map((k) => String.fromCharCode(97 + k))
    .join("");
function records(n: number): Source[] {
  return Array.from({ length: n }, (_, i) => ({
    producer: `${syl(i)}ano ${words[i % 10]} ${words[Math.floor(i / 10) % 10]}`,
    name: `Cuvée ${words[(i * 7) % 10]} ${i}`,
    type: ["red", "white", "rose", "sparkling"][i % 4]!,
    country: ["FR", "IT", "ES", null][i % 4]!,
  }));
}
const bench: Source[] = Array.from({ length: 60 }, (_, i) => ({
  producer: `Château ${syl(i + 9000)}`,
  name: `Grand Vin ${i}`,
  type: "red",
  country: "FR",
  query: `${syl(i + 9000)}ot ${words[i % 10]} grand vin`,
}));
const LEVELS = [
  { level: 1, searches: 600, warmup: 50 },
  { level: 4, searches: 1500, warmup: 50 },
  { level: 16, searches: 1600, warmup: 50 },
];
const mix = () =>
  buildMix({ records: records(6000), benchmark: bench, households: 201, levels: LEVELS, seed: 7 });
const key = (s: Search) => `${s.q}|${s.type}|${s.country}`;

describe("the query mix", () => {
  it("follows the documented proportions exactly at every level: 30% hot, the rest by kind", () => {
    const m = mix();
    for (const l of LEVELS) {
      const list = m.levels.get(l.level)!.measured;
      expect(list).toHaveLength(l.searches);
      const hot = list.filter((s) => s.repeat === "hot").length;
      expect(hot).toBe(Math.round(l.searches * 0.3));
      const q = quotas(l.searches - hot, MIX);
      for (const k of KINDS)
        expect(list.filter((s) => s.repeat === "unique" && s.kind === k).length, k).toBe(q[k]);
      // the whole stream is near the mix too (the hot set has the same kinds)
      for (const k of KINDS)
        expect(
          Math.abs(list.filter((s) => s.kind === k).length / l.searches - MIX[k]),
        ).toBeLessThan(0.02);
    }
  });
  it("the hot set: 30 queries of the same kinds, reused across households", () => {
    const m = mix();
    expect(m.hot).toHaveLength(HOT_SIZE);
    const q = quotas(HOT_SIZE, MIX);
    for (const k of KINDS) expect(m.hot.filter((s) => s.kind === k).length).toBe(q[k]);
    const list = m.levels.get(16)!.measured.filter((s) => s.repeat === "hot");
    const households = new Map<string, Set<number>>();
    for (const s of list)
      households.set(key(s), (households.get(key(s)) ?? new Set()).add(s.household));
    expect(households.size).toBe(HOT_SIZE);
    for (const h of households.values()) expect(h.size).toBeGreaterThan(5);
  });
  it("a unique query is never repeated anywhere in the run (warm-ups and every level) and is never a hot one", () => {
    const m = mix();
    const seen = new Set(m.hot.map(key));
    let n = 0;
    for (const { warmup, measured } of m.levels.values())
      for (const s of [...warmup, ...measured].filter((x) => x.repeat === "unique")) {
        expect(seen.has(key(s)), key(s)).toBe(false);
        seen.add(key(s));
        n++;
      }
    expect(n).toBeGreaterThan(2500);
  });
  it("many households, spread over the stream", () => {
    const list = mix().levels.get(4)!.measured;
    expect(new Set(list.map((s) => s.household)).size).toBeGreaterThan(190);
    expect(
      list.every((s) => Number.isInteger(s.household) && s.household >= 0 && s.household < 201),
    ).toBe(true);
  });
  it("is deterministic in its seed", () => {
    const a = mix().levels.get(4)!.measured;
    const b = mix().levels.get(4)!.measured;
    expect(a).toEqual(b);
    const c = buildMix({
      records: records(6000),
      benchmark: bench,
      households: 201,
      levels: LEVELS,
      seed: 8,
    });
    expect(c.levels.get(4)!.measured).not.toEqual(a);
  });
  it("refuses, rather than repeats, when the sources run out of distinct queries", () => {
    expect(() =>
      buildMix({ records: records(300), benchmark: bench, households: 3, levels: LEVELS, seed: 1 }),
    ).toThrow(/ran out of distinct .* queries/);
  });
  it("builds each kind as typed: prefixes, a typo of one letter, a filter", () => {
    const s: Source = {
      producer: "Château Muga",
      name: "Reserva Especial",
      type: "red",
      country: "ES",
    };
    expect(typed("  Vosne-Romanée 'Les Chaumes' ")).toBe("vosne romanee les chaumes");
    expect(variant(s, "prefix-3", 0)?.q).toBe("cha");
    expect(variant(s, "prefix-8", 0)?.q).toBe("chateau");
    expect(variant(s, "full", 0)?.q).toBe("chateau muga reserva especial");
    expect(variant(s, "producer", 0)?.q).toBe("chateau muga");
    expect(variant(s, "filtered", 0)).toMatchObject({ type: "red", country: "ES" });
    expect(variant(s, "filtered", 1)).toMatchObject({ type: "red", country: null });
    expect(variant(s, "filtered", 2)).toMatchObject({ type: null, country: "ES" });
    expect(variant({ ...s, type: null, country: null }, "filtered", 0)).toBeNull();
    const full = "chateau muga reserva especial";
    for (let salt = 0; salt < 12; salt++) {
      const t = typo(full, salt);
      if (t === null) continue;
      expect(t).not.toBe(full);
      expect(t.length === full.length || t.length === full.length - 1).toBe(true);
    }
  });
  it("quotas always sum to the number asked for", () => {
    for (const n of [0, 1, 7, 30, 599, 1600]) {
      const q = quotas(n, MIX);
      expect(Object.values(q).reduce((a, x) => a + x, 0)).toBe(n);
    }
  });
});

/** Samples of a closed loop of `lanes` clients, each search `ms` long, back to back. */
function samples(lanes: number, perLane: number, ms: number, over: Partial<Sample> = {}): Sample[] {
  const out: Sample[] = [];
  for (let lane = 0; lane < lanes; lane++)
    for (let i = 0; i < perLane; i++)
      out.push({
        kind: KINDS[i % KINDS.length]!,
        repeat: i % 10 < 3 ? "hot" : "unique",
        ok: true,
        start: 1e6 + i * ms,
        end: 1e6 + i * ms + ms,
        pid: 100 + lane,
        rows: i % 20 === 0 ? 0 : 8,
        clientMs: ms + 2,
        ...over,
      });
  return out;
}
function input(level: number, s: Sample[], over: Partial<LevelInput> = {}): LevelInput {
  return {
    level,
    clients: level,
    batch: 10,
    seconds: 60,
    warmup: 150,
    warmupErrors: 0,
    samples: s,
    overheads: [2, 2, 3],
    sampler: null,
    resources: {
      seconds: 60,
      database: { transactions: 400 },
      search_statements: {
        calls: s.length,
        exec_ms: s.length * 40,
        blocks_hit: s.length * 600,
        blocks_read: 0,
        cache_hit_percent: 100,
        temp_blocks_written: 0,
      },
    },
    householdsUsed: 201,
    clientCpuMs: 600,
    ...over,
  };
}

describe("one level's report", () => {
  it("SQL and client latency, throughput, the measured concurrency, per bucket and per search", () => {
    const r = levelReport(input(4, samples(4, 400, 40)));
    expect(r).toMatchObject({
      level: 4,
      searches: 1600,
      ok: 1600,
      throughput_per_s: 26.7,
      empty: 80,
    });
    expect(r.sql).toMatchObject({ n: 1600, p50: 40, p95: 40, mean: 40 });
    expect(r.client).toMatchObject({ p95: 42 });
    expect(r.database_concurrency).toMatchObject({
      peak: 4,
      mean: 4,
      median: 4,
      backends: 4,
      target: 4,
    });
    expect(r.sql_at_level.n).toBe(1600);
    expect(Object.keys(r.by_bucket).sort()).toEqual([...KINDS].sort());
    expect(Object.keys(r.by_repetition).sort()).toEqual(["hot", "unique"]);
    expect(r.per_search).toEqual({
      exec_ms: 40,
      shared_blocks: 600,
      cache_hit_percent: 100,
      temp_blocks: 0,
    });
    expect(r.client_cpu_percent).toBe(1);
    expect(measurementChecks(r).filter((c) => !c.ok)).toEqual([]);
  });
  it("counts every failed search by its SQLSTATE only", () => {
    const bad = samples(1, 10, 40, { ok: false, code: "57014" }).map(
      ({ kind, repeat, ok, code }) => ({ kind, repeat, ok, ...(code ? { code } : {}) }),
    );
    const r = levelReport(input(4, [...samples(4, 400, 40), ...bad]));
    expect(r.errors).toEqual({ count: 10, rate: 0.0062, by_code: { "57014": 10 }, warmup: 0 });
    expect(r.ok).toBe(1600);
  });
  it("carries no query text, no record and no household id (only counts and timings)", () => {
    const hh = Array.from(
      { length: 201 },
      (_, i) => `dddddddd-0000-0000-0000-${String(i).padStart(12, "0")}`,
    );
    const m = mix();
    const list = m.levels.get(4)!.measured;
    const s: Sample[] = list.map((x, i) => ({
      kind: x.kind,
      repeat: x.repeat,
      ok: true,
      start: i,
      end: i + 4,
      pid: 1 + (i % 4),
      rows: 8,
      clientMs: 6,
    }));
    const r = levelReport(input(4, s));
    const text = JSON.stringify({ r, line: summaryLine(r) });
    for (const x of list.filter((y) => y.q.length >= 5))
      expect(text.includes(x.q), x.q).toBe(false);
    for (const h of hh) expect(text.includes(h)).toBe(false);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(text).not.toContain("@");
  });
});

describe("is the measurement valid? (the run's exit code)", () => {
  const ok = () => levelReport(input(4, samples(4, 400, 40)));
  const failing = (r: ReturnType<typeof ok>) =>
    measurementChecks(r)
      .filter((c) => !c.ok)
      .map((c) => c.name);
  it("a failed search fails it", () => {
    const r = ok();
    expect(failing({ ...r, errors: { ...r.errors, count: 1 } })).toEqual([
      "c4: no search failed (warm-up included)",
    ]);
    expect(failing({ ...r, errors: { ...r.errors, warmup: 2 } })).toEqual([
      "c4: no search failed (warm-up included)",
    ]);
  });
  it("too few searches fail it (600 at 1, 1000 at 2, 1500 from 4)", () => {
    expect(failing(levelReport(input(4, samples(4, 300, 40))))).toEqual([
      "c4: at least 1500 searches measured",
    ]);
    expect(measurementChecks(levelReport(input(1, samples(1, 600, 40)))).every((c) => c.ok)).toBe(
      true,
    );
    expect(failing(levelReport(input(2, samples(2, 400, 40))))).toEqual([
      "c2: at least 1000 searches measured",
    ]);
  });
  it("the concurrency not reached in PostgreSQL fails it, whatever the number of clients", () => {
    // 4 clients, but every search one after another (a round trip between them): 1 executing at a time
    const serial = samples(4, 400, 40).map((s, i) => ({ ...s, start: i * 40, end: i * 40 + 40 }));
    expect(failing(levelReport(input(4, serial)))).toEqual([
      "c4: 4 executing in PostgreSQL at once (peak 4, on 4 or more backends, mean at least 85% of 4)",
    ]);
    // half the time only 2 of 4 executing: mean 3, below 85% of 4
    const half = samples(4, 400, 40).map((s) =>
      s.pid! >= 102 ? { ...s, start: s.start! * 2 - 1e6, end: s.start! * 2 - 1e6 + 40 } : s,
    );
    expect(failing(levelReport(input(4, half)))).toHaveLength(1);
  });
  it("exactly N clients", () => {
    expect(failing({ ...ok(), clients: 5 })).toEqual(["c4: exactly 4 clients"]);
  });
});

describe("the proposed release gate (reported, not enforced)", () => {
  const level = (n: number, ms: number) =>
    summaryLine(levelReport(input(n, samples(n, Math.max(600, Math.ceil(1500 / n)), ms))));
  it("met: SQL p95 under 250 ms at 4 concurrent; 8 reported", () => {
    const g = judgeGate([level(1, 40), level(4, 120), level(8, 300)]);
    expect(g.verdict).toBe("met");
    expect(g.rule).toBe("release gate (proposal): SQL p95 < 250 ms at 4 concurrent; at 8 reported");
    expect(g.status).toMatch(/not enforced/);
    expect(g.reported).toEqual([
      { level: 8, sql_p95: 300, under_threshold: false, valid: true, measured: true },
    ]);
  });
  it("not met at 250 ms or more; not measured when the level's measurement is not valid or missing", () => {
    expect(judgeGate([level(4, 250)]).verdict).toBe("not met");
    const broken = level(4, 100);
    expect(judgeGate([{ ...broken, errors: { ...broken.errors, count: 3 } }]).verdict).toBe(
      "not measured",
    );
    expect(judgeGate([level(8, 100)]).verdict).toBe("not measured");
  });
  it("its thresholds are parameters", () => {
    expect(
      judgeGate([level(4, 120), level(8, 120)], { p95_ms: 100, level: 4, report: [8] }).verdict,
    ).toBe("not met");
    expect(
      judgeGate([level(4, 300), level(8, 120)], { p95_ms: 250, level: 8, report: [4] }).verdict,
    ).toBe("met");
    expect(GATE_PROPOSAL).toEqual({ p95_ms: 250, level: 4, report: [8] });
  });
});

describe("messages: one read-only transaction each", () => {
  const esc = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const h = "cccccccc-0000-0000-0000-000000000001";
  const u = "bbbbbbbb-0000-0000-0000-000000000001";
  it("read-only, the role and a timeout set locally, each search between two server clock readings", () => {
    const sql = messageSql(
      [
        { q: "l'ermita", type: "red", country: "ES", household: h },
        { q: "cha", type: null, country: null, household: h },
      ],
      { path: "pilot", timeoutMs: 15000, escape: esc },
    );
    expect(
      sql.startsWith(
        "begin transaction read only; set local role service_role; set local statement_timeout = 15000",
      ),
    ).toBe(true);
    expect(sql.endsWith("; commit")).toBe(true);
    expect(sql).toContain(
      "public.catalog_search_pilot('cccccccc-0000-0000-0000-000000000001'::uuid, 'l''ermita', 'red', 'ES', null, 8)",
    );
    expect(sql.match(/as t0, pg_backend_pid\(\)/g)).toHaveLength(2);
    expect(sql.match(/as t1/g)).toHaveLength(2);
    expect(sql).not.toMatch(
      /\b(insert|update|delete|merge|create|alter|drop|truncate|grant|admin_)\b/i,
    );
  });
  it("the people's path: the household member's claims before each search", () => {
    const sql = messageSql([{ q: "muga", type: null, country: null, household: h, user: u }], {
      path: "public",
      timeoutMs: 15000,
      escape: esc,
    });
    expect(sql).toContain("set local role authenticated");
    expect(sql).toContain(`set_config('request.jwt.claim.sub', '${u}', true)`);
    expect(sql).toContain("from public.catalog_search('cccc");
    expect(() =>
      messageSql([{ q: "muga", type: null, country: null, household: h }], {
        path: "public",
        timeoutMs: 15000,
        escape: esc,
      }),
    ).toThrow(/member/);
  });
  it("refuses anything but a uuid as a household", () => {
    expect(() =>
      messageSql([{ q: "x", type: null, country: null, household: "1; drop table x" }], {
        path: "pilot",
        timeoutMs: 15000,
        escape: esc,
      }),
    ).toThrow(/uuid/);
  });
  it("parses the server's timings back, in order", () => {
    const res = [
      { rows: [] },
      { rows: [{ set_config: "" }] },
      { rows: [{ t0: 10, pid: 7 }] },
      { rows: [{ n: 8 }] },
      { rows: [{ t1: 14.5 }] },
      { rows: [{ t0: 14.6, pid: 7 }] },
      { rows: [{ n: 0 }] },
      { rows: [{ t1: 20 }] },
    ];
    expect(parseMessage(res)).toEqual([
      { start: 10, end: 14.5, pid: 7, rows: 8 },
      { start: 14.6, end: 20, pid: 7, rows: 0 },
    ]);
  });
  it("--batch auto: enough searches per message to hide the round trip (at most 2% idle), 1 to the cap (200 by default)", () => {
    expect(autoBatch([1, 1, 1], [5])).toBe(10);
    expect(autoBatch([20], [100])).toBe(10);
    expect(autoBatch([146], [48])).toBe(150);
    expect(autoBatch([146], [15])).toBe(200);
    expect(autoBatch([146], [15], 0.02, 31)).toBe(31);
    expect(autoBatch([], [5])).toBe(1);
    expect(autoBatch([0.1], [400])).toBe(1);
  });
});

describe("ladder.ts judge: the exit code follows the measurement, never the proposed gate", () => {
  const judge = (levels: unknown[], extra: string[] = []) => {
    const d = mkdtempSync(join(tmpdir(), "ladder-judge-"));
    writeFileSync(join(d, "s.json"), JSON.stringify({ levels }));
    return spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        join(here, "ladder.ts"),
        "judge",
        "--summary",
        join(d, "s.json"),
        ...extra,
      ],
      { cwd: here, encoding: "utf8" },
    );
  };
  const level = (n: number, ms: number) =>
    summaryLine(levelReport(input(n, samples(n, Math.max(600, Math.ceil(1500 / n)), ms))));
  it("valid and gate met: exit 0", () => {
    const r = judge([level(1, 40), level(4, 120), level(8, 200)]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("ladder measurement: VALID");
    expect(r.stdout).toContain(
      "release gate (proposal): SQL p95 < 250 ms at 4 concurrent; at 8 reported: MET",
    );
  });
  it("valid but the proposed gate not met: still exit 0 (reported only)", () => {
    const r = judge([level(4, 400), level(8, 600)]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(": NOT MET");
  });
  it("a failed search: exit 1", () => {
    const l = level(4, 100);
    const r = judge([{ ...l, errors: { ...l.errors, count: 1, by_code: { "57014": 1 } } }]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("ladder measurement: NOT VALID");
  });
  it("no level at all: exit 1", () => {
    expect(judge([]).status).toBe(1);
  });
  it("the gate's thresholds from the command line", () => {
    const r = judge([level(4, 120), level(8, 120)], ["--gate-p95", "100"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("SQL p95 < 100 ms at 4 concurrent");
    expect(r.stdout).toContain(": NOT MET");
  });
});
