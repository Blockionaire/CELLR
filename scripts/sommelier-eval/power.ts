/**
 * STATISTICAL POWER OF THE PLANNED PAIRED COMPARISONS (P8), free, seeded, reproducible:
 *
 *   pnpm --filter @cellr/sommelier-eval run power [--sims 2000] [--json <file>]
 *
 * For v7 against v6 (paired by scenario, clustered by dish, as stats.ts compares them) on each planned set, under
 * stated assumptions, by simulation: the expected 95% interval half-width, the minimum detectable difference at 80%
 * power (two-sided 5%), the chance that a true 5-point regression is NOT detected (the interval does not exclude 0),
 * and the chance that a truly equal V1+ passes the gate's non-inferiority margin (lower bound above −5 points).
 *
 * The free per-scenario vectors of P7 (engines WITHOUT a model, labels written by an AI) are used only as a guide:
 * for the sets' dish structure (scenarios per dish) and for how strongly outcomes cluster within a dish. They say
 * nothing about how often a model's answers differ between v6 and v7; that is a range of assumptions here.
 *
 * The interval is the cluster-robust standard error (1.96 × SE): the percentile bootstrap of stats.ts approximates
 * it, and `calibration` checks the two against the committed P7 comparisons.
 */
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { rng } from "./bench-cellar";
import { MENU_SCENARIOS } from "./scenarios-menu";
import type { ScenarioVector } from "./stats";
import type { VectorFile } from "./vectors";

const RESULTS = new URL("../../docs/sprints/sommelier-3-mega/results/", import.meta.url);
const read = (name: string) =>
  JSON.parse(readFileSync(new URL(name, RESULTS), "utf8")) as VectorFile;

export type Measure = "first" | "noPoor" | "useful";
export const MEASURES: readonly Measure[] = ["first", "noPoor", "useful"];

/** V1 with AI, closeout §5 / COST_REPORT: the baseline rates the comparison starts from. */
export const BASELINE: Record<Measure, number> = { first: 0.78, noPoor: 0.99, useful: 0.92 };

/**
 * The share of scenarios whose outcome differs between v6 and v7 (discordant pairs): unknown before the paid run.
 * Low, middle, high per measure; with a 99% baseline a discordance above 2% cannot occur without a difference.
 */
export const DISCORDANCE: Record<Measure, readonly number[]> = {
  first: [0.08, 0.15, 0.25],
  noPoor: [0.005, 0.01, 0.02],
  useful: [0.04, 0.08, 0.15],
};
export const CENTRAL_DISCORDANCE: Record<Measure, number> = {
  first: 0.15,
  noPoor: 0.01,
  useful: 0.08,
};
/** How strongly scenarios of one dish share their outcome (exchangeable). 0: independent. */
export const CORRELATIONS = [0, 0.3, 0.6] as const;
/**
 * Run-to-run noise: the chance that one run's outcome of a scenario is drawn afresh (at the arm's own rate) instead of
 * being the scenario's usual outcome. 0: the model always answers a scenario the same way.
 */
export const FLIPS = [0, 0.1] as const;
export const RUNS = [1, 3] as const;

/** A set's structure: how many scenarios each dish has (the cluster sizes). */
export interface Design {
  name: string;
  clusters: number[];
  note: string;
}

const clusterSizes = (rows: Record<string, ScenarioVector>) => {
  const by = new Map<string, number>();
  for (const [k, v] of Object.entries(rows))
    by.set(v.cluster ?? k, (by.get(v.cluster ?? k) ?? 0) + 1);
  return [...by.values()].sort((a, b) => b - a);
};

export function designs(): Design[] {
  const set = (name: string) => clusterSizes(read(`p7-vectors-${name}-v1-basic.json`).rows);
  const menuCourses = MENU_SCENARIOS.map((s) => (s.followUp ? 1 : s.courses.length));
  return [
    { name: "main", clusters: set("main"), note: "124 scenarios with a dish, 100 dishes" },
    { name: "holdout-dev", clusters: set("holdout-dev"), note: "45 scenarios, 22 dishes" },
    {
      name: "holdout-test",
      clusters: set("holdout-test"),
      note: "43 scenarios, 22 dishes (blind)",
    },
    {
      name: "menu",
      clusters: menuCourses,
      note: `18 menus (the cluster), ${menuCourses.reduce((a, b) => a + b, 0)} courses scored`,
    },
    {
      name: "human-40",
      clusters: Array(40).fill(2),
      note: "the exploratory part: 40 dishes, asked in English and Dutch (80 scenarios)",
    },
    {
      name: "human-definitive-60",
      clusters: Array(60).fill(2),
      note: "the definitive part: 60 dishes, English and Dutch (120 scenarios), scored once",
    },
    {
      name: "human-100",
      clusters: Array(100).fill(2),
      note: "exploratory and definitive together: 100 dishes, English and Dutch (200 scenarios)",
    },
  ];
}

/** Cluster-robust standard error of the mean of per-scenario differences. */
export function clusterSE(diffs: readonly number[][]): number {
  const all = diffs.flat();
  const n = all.length;
  const mean = all.reduce((a, b) => a + b, 0) / n;
  const c = diffs.length;
  const s = diffs.reduce((acc, d) => {
    const t = d.reduce((a, x) => a + (x - mean), 0);
    return acc + t * t;
  }, 0);
  return Math.sqrt((s / (n * n)) * (c / Math.max(1, c - 1)));
}

interface Assumption {
  p: number;
  discordance: number;
  correlation: number;
  runs: number;
  flip: number;
  /** The true difference v7 − v6 (a share). */
  delta: number;
}

/** One simulated comparison: per cluster, the per-scenario differences of the run means. */
function simulate(design: Design, a: Assumption, pick: () => number): number[][] {
  // y6: v6's usual outcome; D: v7 − v6 at the scenario level, so that P(D≠0) = discordance and E[D] = delta.
  const up = (a.discordance + a.delta) / (2 * (1 - a.p));
  const down = (a.discordance - a.delta) / (2 * a.p);
  return design.clusters.map((size) => {
    const dish = [pick(), pick()];
    return Array.from({ length: size }, () => {
      const shared = pick() < a.correlation;
      const uy = shared ? dish[0]! : pick();
      const ud = shared ? dish[1]! : pick();
      const y6 = uy < a.p ? 1 : 0;
      const y7 = y6 === 1 ? (ud < down ? 0 : 1) : ud < up ? 1 : 0;
      const runMean = (y: number, rate: number) => {
        let s = 0;
        // With chance `flip` a run's outcome is drawn afresh at the arm's rate (it keeps the arm's rate as it is).
        for (let r = 0; r < a.runs; r++) s += pick() < a.flip ? (pick() < rate ? 1 : 0) : y;
        return s / a.runs;
      };
      return runMean(y7, a.p + a.delta) - runMean(y6, a.p);
    });
  });
}

const Z = 1.959964;
const Z80 = 0.841621;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Expected half-width, minimum detectable difference, and the two probabilities at a 5-point margin. */
export function powerOf(design: Design, a: Omit<Assumption, "delta">, sims: number, seed: number) {
  const pick = rng(seed);
  let se0 = 0;
  for (let i = 0; i < sims; i++) se0 += clusterSE(simulate(design, { ...a, delta: 0 }, pick));
  se0 /= sims;
  // A 5-point drop needs at least 5% of scenarios to differ: the discordance is raised to that where it is lower.
  const reg = { ...a, delta: -0.05, discordance: Math.max(a.discordance, 0.05) };
  const regOk =
    reg.discordance <= 2 * Math.min(a.p, 1 - a.p) + 0.05 &&
    (reg.discordance - 0.05) / (2 * (1 - a.p)) <= 1;
  let detected = 0;
  let passesAtEqual = 0;
  let passesAtRegression = 0;
  for (let i = 0; i < sims; i++) {
    const d = simulate(design, { ...a, delta: 0 }, pick);
    const est = d.flat().reduce((x, y) => x + y, 0) / d.flat().length;
    if (est - Z * clusterSE(d) > -0.05) passesAtEqual += 1;
    if (regOk) {
      const r = simulate(design, reg, pick);
      const e = r.flat().reduce((x, y) => x + y, 0) / r.flat().length;
      const se = clusterSE(r);
      if (e + Z * se < 0) detected += 1;
      if (e - Z * se > -0.05) passesAtRegression += 1;
    }
  }
  return {
    halfWidth: r3(Z * se0),
    /** The normal approximation from the standard error with no difference: (1.96 + 0.84) × SE. */
    minimumDetectable80Approx: r3((Z + Z80) * se0),
    minimumDetectable80: minimumDetectable(design, a, Math.max(200, Math.round(sims / 4)), pick),
    regressionNotDetected: regOk ? r3(1 - detected / sims) : null,
    equalPassesMargin: r3(passesAtEqual / sims),
    regressionPassesMargin: regOk ? r3(passesAtRegression / sims) : null,
  };
}

/**
 * The smallest drop (in whole points, up to 40) that the interval excludes 0 for in at least 80% of comparisons,
 * by simulation; the discordance is raised to the drop where it is lower (a drop of d points needs at least d% of
 * scenarios to differ). Null when even 40 points are not found that often.
 */
function minimumDetectable(
  design: Design,
  a: Omit<Assumption, "delta">,
  sims: number,
  pick: () => number,
): number | null {
  const power = (points: number) => {
    const delta = -points / 100;
    const discordance = Math.max(a.discordance, -delta);
    if ((discordance - delta) / (2 * a.p) > 1 || (discordance + delta) / (2 * (1 - a.p)) < 0)
      return 0;
    let hit = 0;
    for (let i = 0; i < sims; i++) {
      const d = simulate(design, { ...a, delta, discordance }, pick);
      const all = d.flat();
      const est = all.reduce((x, y) => x + y, 0) / all.length;
      if (est + Z * clusterSE(d) < 0) hit += 1;
    }
    return hit / sims;
  };
  let lo = 1;
  let hi = 40;
  if (power(hi) < 0.8) return null;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (power(mid) >= 0.8) hi = mid;
    else lo = mid + 1;
  }
  return lo / 100;
}

/** One-way ANOVA intra-cluster correlation of a 0/1 outcome (clusters of size ≥ 1). */
export function icc(rows: Record<string, ScenarioVector>, m: Measure): number {
  const by = new Map<string, number[]>();
  for (const [k, v] of Object.entries(rows)) {
    const c = v.cluster ?? k;
    by.set(c, [...(by.get(c) ?? []), v[m]]);
  }
  const groups = [...by.values()];
  const n = groups.reduce((a, g) => a + g.length, 0);
  const k = groups.length;
  const mean = groups.flat().reduce((a, b) => a + b, 0) / n;
  const ssb = groups.reduce(
    (a, g) => a + g.length * (g.reduce((x, y) => x + y, 0) / g.length - mean) ** 2,
    0,
  );
  const ssw = groups.reduce((a, g) => {
    const gm = g.reduce((x, y) => x + y, 0) / g.length;
    return a + g.reduce((x, y) => x + (y - gm) ** 2, 0);
  }, 0);
  const n0 = (n - groups.reduce((a, g) => a + g.length ** 2, 0) / n) / (k - 1);
  const msb = ssb / (k - 1);
  const msw = ssw / (n - k);
  const v = (msb - msw) / (msb + (n0 - 1) * msw);
  return Number.isFinite(v) ? r3(v) : 0;
}

/** The cluster-robust half-width on the committed P7 vectors, against the bootstrap half-width P7 recorded. */
export function calibration() {
  const p7 = JSON.parse(readFileSync(new URL("p7-fallback.json", RESULTS), "utf8")) as {
    sets: Record<string, { difference: Record<Measure, { low: number; high: number }> }>;
  };
  return ["main", "holdout-dev", "holdout-test"].map((set) => {
    const a = read(`p7-vectors-${set}-v1-fallback.json`).rows;
    const b = read(`p7-vectors-${set}-v1-basic.json`).rows;
    const keys = Object.keys(a).filter((k) => k in b);
    const by = new Map<string, string[]>();
    for (const k of keys) by.set(a[k]!.cluster ?? k, [...(by.get(a[k]!.cluster ?? k) ?? []), k]);
    return {
      set,
      measures: Object.fromEntries(
        MEASURES.map((m) => {
          const diffs = [...by.values()].map((ks) => ks.map((k) => a[k]![m] - b[k]![m]));
          const d = p7.sets[set]!.difference[m];
          return [
            m,
            {
              clusterRobust: r3(Z * clusterSE(diffs)),
              bootstrapRecorded: r3((d.high - d.low) / 2),
            },
          ];
        }),
      ),
    };
  });
}

/** What "0 invented facts in n answers" supports: the rule of three, an upper 95% bound of 3/n. */
export function ruleOfThree() {
  const per = [
    ["main (v7, one run)", 131],
    ["probe (v7 with annotate, one run)", 18],
    ["holdout-dev (v7, one run)", 45],
    ["holdout-test (v7, one run)", 43],
    ["all three sets (v7, one run)", 219],
    ["all three sets, 3 runs, IF the runs were independent (they are not)", 657],
    ["menu set, menu on (one run)", 21],
    ["menu set, menu on (3 runs, IF independent)", 63],
    ["human holdout, exploratory 40 dishes (80 scenarios)", 80],
    ["human holdout, definitive 60 dishes (120 scenarios)", 120],
    ["human holdout, 100 dishes (200 scenarios)", 200],
  ] as const;
  return per.map(([what, n]) => ({ what, n, upper95: r3(3 / n) }));
}

export function powerTable(sims = 2000) {
  const rows = [];
  let seed = 0x9e3779b1;
  for (const design of designs())
    for (const m of MEASURES)
      for (const discordance of DISCORDANCE[m])
        for (const correlation of CORRELATIONS)
          for (const runs of RUNS)
            for (const flip of FLIPS) {
              if (runs === 3 && flip === 0) continue; // the same as one run: nothing varies between runs
              seed = (seed + 0x6d2b79f5) >>> 0;
              rows.push({
                set: design.name,
                measure: m,
                baseline: BASELINE[m],
                discordance,
                correlation,
                runs,
                flip,
                seed,
                ...powerOf(
                  design,
                  { p: BASELINE[m], discordance, correlation, runs, flip },
                  sims,
                  seed,
                ),
              });
            }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: args } = parseArgs({
    options: { sims: { type: "string", default: "2000" }, json: { type: "string" } },
  });
  const sims = Number(args.sims);
  const guide = {
    iccFromFreeVectors: Object.fromEntries(
      ["v1-fallback", "v1-basic"].map((e) => [
        e,
        Object.fromEntries(
          ["main", "holdout-dev"].map((set) => [
            set,
            Object.fromEntries(
              MEASURES.map((m) => [m, icc(read(`p7-vectors-${set}-${e}.json`).rows, m)]),
            ),
          ]),
        ),
      ]),
    ),
    calibration: calibration(),
  };
  const rows = powerTable(sims);
  const central = rows.filter(
    (r) =>
      r.discordance === CENTRAL_DISCORDANCE[r.measure as Measure] &&
      r.correlation === 0.3 &&
      r.runs === 3 &&
      r.flip === 0.1,
  );
  console.log(
    `Seeded simulation, ${sims} comparisons per setting. Central assumption: discordance first ${CENTRAL_DISCORDANCE.first}, no poor ${CENTRAL_DISCORDANCE.noPoor}, useful ${CENTRAL_DISCORDANCE.useful}; within-dish correlation 0.3; 3 runs per arm; run-to-run flip 0.1.`,
  );
  console.log(
    "| Set | Measure | ± half-width | Minimum detectable (80%) | P(a true −5 is NOT detected) | P(equal passes −5 margin) |",
  );
  console.log("| --- | --- | ---: | ---: | ---: | ---: |");
  for (const r of central)
    console.log(
      `| ${r.set} | ${r.measure} | ${(100 * r.halfWidth).toFixed(1)} | ${r.minimumDetectable80 === null ? "> 40" : (100 * r.minimumDetectable80).toFixed(0)} | ${r.regressionNotDetected === null ? "-" : r.regressionNotDetected.toFixed(2)} | ${r.equalPassesMargin.toFixed(2)} |`,
    );
  console.log(JSON.stringify(guide, null, 1));
  if (args.json)
    await writeFile(
      args.json,
      JSON.stringify(
        {
          what: "Power of the planned paired comparisons (v7 vs v6), by seeded simulation. The free P7 vectors (engines without a model; AI-written labels) are only a guide to dish structure and clustering.",
          sims,
          baseline: BASELINE,
          discordance: DISCORDANCE,
          centralDiscordance: CENTRAL_DISCORDANCE,
          correlations: CORRELATIONS,
          flips: FLIPS,
          runs: RUNS,
          designs: designs().map((d) => ({
            name: d.name,
            clusters: d.clusters.length,
            scenarios: d.clusters.reduce((a, b) => a + b, 0),
            note: d.note,
          })),
          guide,
          central,
          ruleOfThree: ruleOfThree(),
          rows,
        },
        null,
        2,
      ) + "\n",
    );
}
