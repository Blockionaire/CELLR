import { describe, expect, it } from "vitest";
import { checkSides, checkVectorFiles, compare, dropped } from "./compare";
import { pairedProportion, pairedRatio, type ScenarioVector } from "./stats";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { vectorKeyer, type VectorFile } from "./vectors";

const SALT = "0f3a9c2e7b14d856a1e0";

const v = (first: 0 | 1, poor = 0, offered = 1): ScenarioVector => ({
  first,
  noPoor: poor > 0 ? 0 : 1,
  useful: poor > 0 ? 0 : 1,
  offered,
  poor,
  good: offered - poor,
});
/** n scenarios, with engine a right on the first `aRight` and b right on the first `bRight`. */
function engines(n: number, aRight: number, bRight: number) {
  const a = new Map<string, ScenarioVector>();
  const b = new Map<string, ScenarioVector>();
  for (let i = 0; i < n; i += 1) {
    a.set(`s${i}`, v(i < aRight ? 1 : 0));
    b.set(`s${i}`, v(i < bRight ? 1 : 0));
  }
  return { a, b };
}

describe("a comparison counts scenarios, not runs", () => {
  it("gives the same interval for the same answers run once or ten times", () => {
    const { a, b } = engines(40, 30, 24);
    const once = pairedProportion([a], [b], "first");
    const tenTimes = pairedProportion(Array(10).fill(a), Array(10).fill(b), "first");
    expect(tenTimes).toMatchObject({
      diff: once.diff,
      low: once.low,
      high: once.high,
      scenarios: 40,
    });
    expect(once.diff).toBeCloseTo(0.15);
  });

  it("is wider for fewer scenarios, whatever the number of runs", () => {
    const many = engines(80, 60, 48);
    const few = engines(20, 15, 12);
    const wide = pairedProportion(Array(20).fill(few.a), Array(20).fill(few.b), "first");
    const narrow = pairedProportion([many.a], [many.b], "first");
    expect(wide.high - wide.low).toBeGreaterThan(narrow.high - narrow.low);
  });

  it("averages runs within a scenario: a scenario right in two of four runs counts as one half", () => {
    const right = new Map([["s0", v(1)]]);
    const wrong = new Map([["s0", v(0)]]);
    const r = pairedProportion([right, right, wrong, wrong], [wrong], "first");
    expect(r.diff).toBeCloseTo(0.5);
    expect(r.scenarios).toBe(1);
  });

  it("pairs: a difference both engines share in every scenario has no spread", () => {
    const { a, b } = engines(30, 30, 0);
    expect(pairedProportion([a], [b], "first")).toMatchObject({ diff: 1, low: 1, high: 1 });
  });

  it("compares only the scenarios every run of both answered", () => {
    const { a, b } = engines(10, 5, 5);
    const short = new Map([...a].slice(0, 6));
    expect(pairedProportion([a, short], [b], "first").scenarios).toBe(6);
  });

  it("counts bottles per answer, not as independent bottles", () => {
    // a: one answer with ten poor bottles, nine clean answers of one bottle; b: every answer one clean bottle.
    const a = new Map<string, ScenarioVector>([["s0", v(0, 10, 10)]]);
    const b = new Map<string, ScenarioVector>([["s0", v(1, 0, 1)]]);
    for (let i = 1; i < 10; i += 1) {
      a.set(`s${i}`, v(1, 0, 1));
      b.set(`s${i}`, v(1, 0, 1));
    }
    const r = pairedRatio([a], [b], "poor");
    expect(r.diff).toBeCloseTo(10 / 19);
    // One scenario carries all of a's poor bottles: resampling scenarios shows how fragile that is.
    expect(r.low).toBe(0);
  });
});

const withoutCluster = (x: ScenarioVector): ScenarioVector => {
  const copy = { ...x };
  delete copy.cluster;
  return copy;
};

describe("scenarios about one dish count as that dish", () => {
  it("is as wide for 20 dishes asked twice as for the 20 dishes asked once", () => {
    const once = engines(20, 15, 10);
    const twice = { a: new Map<string, ScenarioVector>(), b: new Map<string, ScenarioVector>() };
    for (const side of ["a", "b"] as const)
      for (const [id, x] of once[side])
        for (const lang of ["en", "nl"]) twice[side].set(`${id}-${lang}`, { ...x, cluster: id });
    const r1 = pairedProportion([once.a], [once.b], "first");
    const r2 = pairedProportion([twice.a], [twice.b], "first");
    expect(r2).toMatchObject({ scenarios: 40, clusters: 20, diff: r1.diff });
    expect(r2.high - r2.low).toBeCloseTo(r1.high - r1.low, 1);
    // Without the dish, the same 40 scenarios would seem to say more than they do.
    const naive = {
      a: new Map([...twice.a].map(([k, x]) => [k, withoutCluster(x)])),
      b: new Map([...twice.b].map(([k, x]) => [k, withoutCluster(x)])),
    };
    const r3 = pairedProportion([naive.a], [naive.b], "first");
    expect(r3.high - r3.low).toBeLessThan(r2.high - r2.low);
  });
});

describe("edge cases", () => {
  it("a resample with no bottle offered is left out, never read as 0% poor", () => {
    const a = new Map<string, ScenarioVector>([
      ["s0", v(1, 1, 1)],
      ["s1", { ...v(1, 0, 0), offered: 0, good: 0 }],
    ]);
    const b = new Map<string, ScenarioVector>([
      ["s0", v(1, 0, 1)],
      ["s1", v(1, 0, 1)],
    ]);
    const r = pairedRatio([a], [b], "poor", { rounds: 400 });
    expect(r.undefinedDraws).toBeGreaterThan(0);
    expect(r.low).toBeGreaterThan(0);
  });
});

describe("vector files", () => {
  const file = (over: Partial<VectorFile>): VectorFile => ({
    set: "holdout-dev",
    engine: "v1-ai",
    keyed: "id",
    salt: null,
    incomplete: false,
    rows: { s0: v(1) },
    ...over,
  });

  it("refuses to pair files of different sets, salts or an incomplete run", () => {
    expect(checkVectorFiles([file({}), file({ engine: "v3-app" })])).toBeNull();
    expect(checkVectorFiles([file({}), file({ set: "main" })])).toMatch(/different sets/);
    expect(
      checkVectorFiles([
        file({ keyed: "salted-sha256", salt: "aaaa" }),
        file({ keyed: "salted-sha256", salt: "bbbb" }),
      ]),
    ).toMatch(/salt/);
    expect(checkVectorFiles([file({}), file({ incomplete: true })])).toMatch(/stopped early/);
    expect(compare([file({})], [file({ rows: { s0: v(0) } })]).first.diff).toBe(1);
    expect(checkSides([file({}), file({ engine: "v3-app" })], [file({})])).toMatch(/mixes engines/);
    expect(dropped([file({ rows: { s0: v(1), s1: v(1) } })], [file({})])).toEqual({ a: 1, b: 0 });
  });

  it("keys a blind set by a salted hash, outside every Git checkout only", () => {
    expect(() =>
      vectorKeyer("holdout-test", "/tmp/x.json", { SOMMELIER_EVAL_BLIND_SALT: "a".repeat(32) }),
    ).toThrow(/random/);
    const link = join(mkdtempSync(join(tmpdir(), "vec-")), "into-repo");
    symlinkSync(fileURLToPath(new URL(".", import.meta.url)), link);
    expect(() =>
      vectorKeyer("holdout-test", join(link, "x.json"), { SOMMELIER_EVAL_BLIND_SALT: SALT }),
    ).toThrow(/outside every Git checkout/);
    expect(() => vectorKeyer("holdout-test", "/tmp/x.json", {})).toThrow(/SALT/);
    expect(() =>
      vectorKeyer("holdout-test", "results/x.json", { SOMMELIER_EVAL_BLIND_SALT: SALT }),
    ).toThrow(/outside every Git checkout/);
    const k = vectorKeyer("holdout-test", "/tmp/x.json", {
      SOMMELIER_EVAL_BLIND_SALT: SALT,
    });
    expect(k.keyed).toBe("salted-sha256");
    expect(k.key("ht-001")).not.toContain("ht-001");
    expect(k.key("ht-001")).toBe(k.key("ht-001"));
    expect(vectorKeyer("holdout-dev", "anywhere.json", {}).key("ho-001")).toBe("ho-001");
  });
});
