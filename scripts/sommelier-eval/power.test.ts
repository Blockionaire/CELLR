import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calibration, designs, powerOf, ruleOfThree, type Measure } from "./power";

/**
 * THE POWER ANALYSIS (P8_POWER_ANALYSIS.md) IS REPRODUCIBLE: seeded, and its interval is the one stats.ts's
 * bootstrap gives. The committed numbers are recomputed for two settings from their recorded seeds.
 */
const recorded = JSON.parse(
  readFileSync(
    new URL("../../docs/sprints/sommelier-3-mega/results/p8-power.json", import.meta.url),
    "utf8",
  ),
) as {
  sims: number;
  rows: Array<{
    set: string;
    measure: Measure;
    baseline: number;
    discordance: number;
    correlation: number;
    runs: number;
    flip: number;
    seed: number;
  }>;
};

describe("the power analysis", () => {
  it("has the planned sets' sizes", () => {
    const d = Object.fromEntries(designs().map((x) => [x.name, x.clusters]));
    expect([d.main!.length, d.main!.reduce((a, b) => a + b, 0)]).toEqual([100, 124]);
    expect([d["holdout-dev"]!.length, d["holdout-dev"]!.reduce((a, b) => a + b, 0)]).toEqual([
      22, 45,
    ]);
    expect([d["holdout-test"]!.length, d["holdout-test"]!.reduce((a, b) => a + b, 0)]).toEqual([
      22, 43,
    ]);
    expect(d.menu).toHaveLength(18);
    expect(d["human-40"]).toHaveLength(40);
    expect(d["human-100"]).toHaveLength(100);
  });

  it("uses an interval that matches the bootstrap of stats.ts on the committed P7 comparisons", () => {
    for (const set of calibration())
      for (const [m, c] of Object.entries(set.measures))
        expect(Math.abs(c.clusterRobust - c.bootstrapRecorded), `${set.set} ${m}`).toBeLessThan(
          0.015,
        );
  });

  it("recomputes the committed numbers from their seeds", () => {
    const pick = (set: string, measure: Measure) =>
      recorded.rows.find(
        (r) =>
          r.set === set &&
          r.measure === measure &&
          r.correlation === 0.3 &&
          r.runs === 3 &&
          r.flip === 0.1 &&
          r.discordance === (measure === "first" ? 0.15 : measure === "noPoor" ? 0.01 : 0.08),
      )!;
    for (const row of [pick("human-40", "first"), pick("holdout-test", "useful")]) {
      const design = designs().find((d) => d.name === row.set)!;
      const now = powerOf(
        design,
        {
          p: row.baseline,
          discordance: row.discordance,
          correlation: row.correlation,
          runs: row.runs,
          flip: row.flip,
        },
        recorded.sims,
        row.seed,
      );
      expect({ ...row, ...now }).toEqual(row);
    }
  }, 120_000);

  it("states what zero invented facts in n answers supports: an upper bound of 3/n", () => {
    const r = ruleOfThree();
    expect(r.find((x) => x.n === 219)!.upper95).toBeCloseTo(3 / 219, 3);
    expect(r.every((x) => x.upper95 === Math.round((3 / x.n) * 1000) / 1000)).toBe(true);
  });
});
