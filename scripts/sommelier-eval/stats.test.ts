import { describe, expect, it } from "vitest";
import { checkVectorFiles, compare } from "./compare";
import { pairedProportion, pairedRatio, type ScenarioVector } from "./stats";
import { vectorKeyer, type VectorFile } from "./vectors";

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
  });

  it("keys a blind set by a salted hash, outside the repository only", () => {
    expect(() => vectorKeyer("holdout-test", "/tmp/x.json", {})).toThrow(/SALT/);
    expect(() =>
      vectorKeyer("holdout-test", "results/x.json", { SOMMELIER_EVAL_BLIND_SALT: "s".repeat(16) }),
    ).toThrow(/outside the repository/);
    const k = vectorKeyer("holdout-test", "/tmp/x.json", {
      SOMMELIER_EVAL_BLIND_SALT: "s".repeat(16),
    });
    expect(k.keyed).toBe("salted-sha256");
    expect(k.key("ht-001")).not.toContain("ht-001");
    expect(k.key("ht-001")).toBe(k.key("ht-001"));
    expect(vectorKeyer("holdout-dev", "anywhere.json", {}).key("ho-001")).toBe("ho-001");
  });
});
