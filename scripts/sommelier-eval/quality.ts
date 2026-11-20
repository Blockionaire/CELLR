import type { ScenarioResult } from "./score";
import type { DishCard, EvalAnswer, Scenario, Verdict } from "./types";

/**
 * QUALITY PER BOTTLE AND PER PLACE (S10). The benchmark's checks pass or fail a scenario as a whole, and one of
 * them ("no offered bottle is a poor match") is easier to pass for an engine that offers one bottle than for one
 * that offers three. These measures do not change any check; they look at the same answers bottle by bottle:
 *
 * - what is offered at place 1, 2 and 3, by the reference card's label (good, ok, poor);
 * - the share of all offered bottles that are poor, so offering more is not punished per scenario;
 * - a useful answer: something to open whose first bottle is at least "ok" and none of whose bottles is poor, or
 *   nothing at all when nothing suits;
 * - how many bottles are offered;
 * - the dish read right (where the engine says what it read).
 *
 * Only scenarios about a dish, with a reference outcome, that the engine could attempt are counted.
 */
export type Label = "good" | "ok" | "poor";

export interface QualityTotals {
  scenarios: number;
  /** By place: [good, ok, poor] counts of the bottle offered there. */
  byPlace: Array<{ place: number; good: number; ok: number; poor: number }>;
  offeredBottles: number;
  poorBottles: number;
  goodBottles: number;
  useful: number;
  /** Something offered where a reference wine at least "ok" was in the cellar. */
  answeredWhenPossible: [number, number];
  /** Nothing offered where the reference says nothing suits. */
  honestNone: [number, number];
  /** Scenarios by how many bottles were offered: 0, 1, 2, 3+. */
  counts: [number, number, number, number];
  /** The dish read right, where the engine said what it read: [right, read]. */
  dishRead: [number, number];
}

export interface QualityRow {
  id: string;
  labels: Label[];
  useful: boolean;
  expected: Verdict | null;
  dishRight: boolean | null;
}

export const labelOf = (card: DishCard, key: string): Label =>
  card.good.includes(key) ? "good" : card.ok.includes(key) ? "ok" : "poor";

export function qualityRow(
  scenario: Scenario,
  card: DishCard | null,
  answer: EvalAnswer,
  result: ScenarioResult,
  cellarKeys: readonly string[],
): QualityRow | null {
  if (!card || !result.supported || result.expectedVerdict === null) return null;
  const labels = answer.bottles.map((k) => labelOf(card, k));
  const expected = result.expectedVerdict;
  const anySuits = cellarKeys.some((k) => labelOf(card, k) !== "poor");
  const useful =
    labels.length === 0
      ? expected === "none" || !anySuits
      : labels[0] !== "poor" && !labels.includes("poor");
  const food = result.checks.find((c) => c.name === "food");
  return {
    id: scenario.id,
    labels,
    useful,
    expected,
    dishRight: answer.food?.truth === undefined ? null : (food?.pass ?? null),
  };
}

export function qualityTotals(
  rows: readonly QualityRow[],
  cellarOf: (id: string) => readonly string[],
  cards: (id: string) => DishCard | null,
): QualityTotals {
  const t: QualityTotals = {
    scenarios: rows.length,
    byPlace: [1, 2, 3].map((place) => ({ place, good: 0, ok: 0, poor: 0 })),
    offeredBottles: 0,
    poorBottles: 0,
    goodBottles: 0,
    useful: 0,
    answeredWhenPossible: [0, 0],
    honestNone: [0, 0],
    counts: [0, 0, 0, 0],
    dishRead: [0, 0],
  };
  for (const r of rows) {
    r.labels.slice(0, 3).forEach((l, i) => (t.byPlace[i]![l] += 1));
    t.offeredBottles += r.labels.length;
    t.poorBottles += r.labels.filter((l) => l === "poor").length;
    t.goodBottles += r.labels.filter((l) => l === "good").length;
    if (r.useful) t.useful += 1;
    t.counts[Math.min(3, r.labels.length)]! += 1;
    if (r.expected === "none") {
      t.honestNone[1] += 1;
      if (r.labels.length === 0) t.honestNone[0] += 1;
    } else {
      const card = cards(r.id);
      if (card && cellarOf(r.id).some((k) => labelOf(card, k) !== "poor")) {
        t.answeredWhenPossible[1] += 1;
        if (r.labels.length > 0) t.answeredWhenPossible[0] += 1;
      }
    }
    if (r.dishRight !== null) {
      t.dishRead[1] += 1;
      if (r.dishRight) t.dishRead[0] += 1;
    }
  }
  return t;
}

const pct = (a: number, b: number) => (b === 0 ? "—" : `${Math.round((100 * a) / b)}%`);

export function formatQuality(q: QualityTotals): string {
  const place = q.byPlace
    .map(
      (p) =>
        `| ${p.place} | ${p.good + p.ok + p.poor} | ${pct(p.good, p.good + p.ok + p.poor)} | ${pct(p.ok, p.good + p.ok + p.poor)} | ${pct(p.poor, p.good + p.ok + p.poor)} |`,
    )
    .join("\n");
  return [
    `Quality per bottle (S10): ${q.scenarios} scenarios about a dish with a reference outcome.`,
    `- Useful answer: ${q.useful} (${pct(q.useful, q.scenarios)}). Bottles offered: ${q.offeredBottles}, of which poor ${q.poorBottles} (${pct(q.poorBottles, q.offeredBottles)}), good ${q.goodBottles} (${pct(q.goodBottles, q.offeredBottles)}).`,
    `- Answered when something suited: ${q.answeredWhenPossible[0]} of ${q.answeredWhenPossible[1]}. Nothing offered when nothing suits: ${q.honestNone[0]} of ${q.honestNone[1]}.`,
    `- Scenarios by bottles offered: 0: ${q.counts[0]}, 1: ${q.counts[1]}, 2: ${q.counts[2]}, 3+: ${q.counts[3]}. Dish read right: ${q.dishRead[1] === 0 ? "not stated by this engine" : `${q.dishRead[0]} of ${q.dishRead[1]}`}.`,
    "",
    "| Place | Offered | Good | Ok | Poor |",
    "| ---: | ---: | ---: | ---: | ---: |",
    place,
  ].join("\n");
}

/**
 * A paired bootstrap of the difference between two engines on the same scenarios: the share of resamples in
 * which the first is not better (a one-sided p-value), and a 95% interval of the difference. Deterministic.
 */
export function pairedBootstrap(
  a: readonly number[],
  b: readonly number[],
  rounds = 4000,
): { diff: number; low: number; high: number; pNotBetter: number } {
  if (a.length !== b.length || a.length === 0) throw new Error("paired samples of equal length");
  let seed = 20261120;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const n = a.length;
  const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const d = a.map((x, i) => x - b[i]!);
  const diffs: number[] = [];
  for (let r = 0; r < rounds; r += 1) {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += d[Math.floor(rand() * n)]!;
    diffs.push(s / n);
  }
  diffs.sort((x, y) => x - y);
  return {
    diff: mean(d),
    low: diffs[Math.floor(0.025 * rounds)]!,
    high: diffs[Math.floor(0.975 * rounds)]!,
    pNotBetter: diffs.filter((x) => x <= 0).length / rounds,
  };
}
