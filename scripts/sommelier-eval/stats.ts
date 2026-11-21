/**
 * COMPARING TWO ENGINES ON THE SAME SCENARIOS (S11). The unit of observation is the scenario, not the run: a model
 * answers the same question again with much the same answer, so a second run of a scenario is not a new
 * observation. Every comparison here therefore
 *
 * 1. averages each engine's runs WITHIN a scenario first (a scenario counts once, however often it was run), then
 * 2. resamples SCENARIOS (a paired, cluster bootstrap): both engines' values of a drawn scenario go together, so
 *    what the scenarios share (an easy dish, a hard cellar) cancels out of the difference.
 *
 * A measure per bottle (poor bottles of all offered) is a ratio of sums over the drawn scenarios, so the bottles of
 * one answer are never counted as independent either. Running a scenario more often narrows nothing here except
 * the run-to-run noise inside its own average (benchmark-stats.test.ts checks this).
 *
 * The scenarios themselves are a sample of one person's idea of dishes, written by an AI and labelled by one: the
 * interval says how far the result could move with other scenarios like these, not how real people's dishes go.
 */

/** One scenario's outcome in one run. */
export interface ScenarioVector {
  /** The first bottle passed the scorer's check. */
  first: 0 | 1;
  /** No bottle offered was labelled poor (also 1 when none was offered). */
  noPoor: 0 | 1;
  /** The answer was useful (`qualityRow`). */
  useful: 0 | 1;
  /** Bottles offered, and of those labelled poor and good. */
  offered: number;
  poor: number;
  good: number;
}

export type Runs = ReadonlyArray<ReadonlyMap<string, ScenarioVector>>;
export type Proportion = "first" | "noPoor" | "useful";
export type Ratio = "poor" | "good";

export interface Interval {
  /** Difference a − b, in the measure's own unit (a share: −1 to 1). */
  diff: number;
  low: number;
  high: number;
  /** Scenarios in both, in every run of both: the n of the comparison. */
  scenarios: number;
  runsA: number;
  runsB: number;
  /** Ratio measures only: resamples left out because an engine offered no bottle in them. */
  undefinedDraws?: number;
}

/** A small, seeded generator, so a comparison gives the same interval every time it is run. */
function xorshift(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x100000000;
  };
}

/** The scenarios every run of both engines answered (a run stopped early leaves out its missing ones). */
export function commonScenarios(a: Runs, b: Runs): string[] {
  const all = [...a, ...b];
  if (all.length === 0) return [];
  return [...all[0]!.keys()].filter((k) => all.every((r) => r.has(k))).sort();
}

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

function quantiles(sorted: readonly number[]): [number, number] {
  // Linear interpolation between order statistics, at (n − 1)·q: symmetric at both ends.
  const at = (q: number) => {
    const h = (sorted.length - 1) * q;
    const lo = Math.floor(h);
    const hi = Math.min(sorted.length - 1, lo + 1);
    return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
  };
  return [at(0.025), at(0.975)];
}

/** Per scenario: the engine's mean over its runs of `f`. */
function perScenario(runs: Runs, ids: readonly string[], f: (v: ScenarioVector) => number) {
  return ids.map((id) => mean(runs.map((r) => f(r.get(id)!))));
}

/** A share (first bottle right, no poor bottle, useful): mean over scenarios of each scenario's run mean. */
export function pairedProportion(
  a: Runs,
  b: Runs,
  measure: Proportion,
  options: { rounds?: number; seed?: number } = {},
): Interval {
  const ids = commonScenarios(a, b);
  const da = perScenario(a, ids, (v) => v[measure]);
  const db = perScenario(b, ids, (v) => v[measure]);
  const diffs = da.map((x, i) => x - db[i]!);
  const rounds = options.rounds ?? 4000;
  const rnd = xorshift(options.seed ?? 20261121);
  const boots: number[] = [];
  for (let r = 0; r < rounds; r += 1) {
    let s = 0;
    for (let i = 0; i < diffs.length; i += 1) s += diffs[Math.floor(rnd() * diffs.length)]!;
    boots.push(s / diffs.length);
  }
  boots.sort((x, y) => x - y);
  const [low, high] = ids.length === 0 ? [NaN, NaN] : quantiles(boots);
  return {
    diff: ids.length === 0 ? NaN : mean(diffs),
    low,
    high,
    scenarios: ids.length,
    runsA: a.length,
    runsB: b.length,
  };
}

/**
 * A share of bottles (poor of all offered): sum over the drawn scenarios of each scenario's mean poor count,
 * divided by the sum of its mean offered count, for each engine; the difference of the two ratios.
 */
export function pairedRatio(
  a: Runs,
  b: Runs,
  measure: Ratio,
  options: { rounds?: number; seed?: number } = {},
): Interval {
  const ids = commonScenarios(a, b);
  const na = perScenario(a, ids, (v) => v[measure]);
  const oa = perScenario(a, ids, (v) => v.offered);
  const nb = perScenario(b, ids, (v) => v[measure]);
  const ob = perScenario(b, ids, (v) => v.offered);
  // No bottle offered in the drawn scenarios: the share is undefined, not 0% (that would read as "nothing poor").
  const ratio = (num: readonly number[], den: readonly number[], pick: readonly number[]) => {
    let n = 0;
    let d = 0;
    for (const i of pick) {
      n += num[i]!;
      d += den[i]!;
    }
    return d === 0 ? NaN : n / d;
  };
  const every = ids.map((_, i) => i);
  const rounds = options.rounds ?? 4000;
  const rnd = xorshift(options.seed ?? 20261121);
  const boots: number[] = [];
  let undefinedDraws = 0;
  for (let r = 0; r < rounds; r += 1) {
    const pick = every.map(() => Math.floor(rnd() * every.length));
    const d = ratio(na, oa, pick) - ratio(nb, ob, pick);
    // A resample in which one engine offered nothing has no difference to give: it is left out (and counted).
    if (Number.isNaN(d)) undefinedDraws += 1;
    else boots.push(d);
  }
  boots.sort((x, y) => x - y);
  const [low, high] = boots.length === 0 ? [NaN, NaN] : quantiles(boots);
  return {
    diff: ids.length === 0 ? NaN : ratio(na, oa, every) - ratio(nb, ob, every),
    low,
    high,
    scenarios: ids.length,
    runsA: a.length,
    runsB: b.length,
    undefinedDraws,
  };
}
