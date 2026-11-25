import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  checkHumanDishes,
  HUMAN_HOLDOUT_ENV,
  HUMAN_HOLDOUT_MIN_DISHES,
  readEscrowed,
  type HumanDish,
  type HumanHoldoutSeal,
} from "./human-holdout";
import type { DishCard, Scenario } from "./types";

/**
 * THE HUMAN HOLDOUT IN TWO PARTS (owner decision, 2026-11-25): 100 independent dishes, 40 EXPLORATORY and 60
 * DEFINITIVE. The definitive 60 stay blind: sealed on their own, never seen by an agent or used for tuning, and scored
 * only once, after the build is frozen. The full set (`human`, 100, human-holdout.ts) keeps its own escrow and its
 * minimum of 100 unchanged; it is not scored as such (run.ts refuses definitive dishes outside their own set).
 *
 * - `human-exploratory`: exactly 40 dishes `hh-x-…`, from SOMMELIER_EVAL_HUMAN_EXPLORATORY_FILE and checked against
 *   human-holdout/SEAL-exploratory.json; blind (totals only); every report is marked EXPLORATORY.
 * - `human-definitive`: exactly 60 dishes `hh-d-…`, from SOMMELIER_EVAL_HUMAN_DEFINITIVE_FILE and checked against
 *   human-holdout/SEAL-definitive.json; run.ts refuses it without `--definitive` and `--frozen-at <sha>` matching the
 *   recorded freeze (results/p8-build-frozen.json) and the checked-out commit, and refuses a second scoring of the same
 *   seal by the same engine (results/p8-definitive-scored.json, written BEFORE the run: a crashed run counts).
 */
export const SERIES = {
  exploratory: { dishes: 40, prefix: "hh-x-" },
  definitive: { dishes: 60, prefix: "hh-d-" },
} as const;
export type Series = keyof typeof SERIES;

export const EXPLORATORY_SET = "human-exploratory";
export const DEFINITIVE_SET = "human-definitive";
export const HUMAN_EXPLORATORY_ENV = "SOMMELIER_EVAL_HUMAN_EXPLORATORY_FILE";
export const HUMAN_DEFINITIVE_ENV = "SOMMELIER_EVAL_HUMAN_DEFINITIVE_FILE";
export const SEAL_OF: Record<Series, URL> = {
  exploratory: new URL("./human-holdout/SEAL-exploratory.json", import.meta.url),
  definitive: new URL("./human-holdout/SEAL-definitive.json", import.meta.url),
};
const RESULTS = new URL("../../docs/sprints/sommelier-3-mega/results/", import.meta.url);
export const FROZEN_RECORD = new URL("p8-build-frozen.json", RESULTS);
export const SCORED_RECORD = new URL("p8-definitive-scored.json", RESULTS);

/** Printed above, and recorded in, every report of the exploratory 40. */
export const EXPLORATORY_NOTE =
  "EXPLORATORY: human holdout, exploratory 40 dishes only. They can only catch a large regression (about 12 points or more in first bottle right, P8_POWER_ANALYSIS.md); no claim that V1+ is as good as V1 can rest on them. Not the definitive measurement.";
/** Printed above every report of the definitive 60, which is reported apart from everything else. */
export const DEFINITIVE_NOTE =
  "DEFINITIVE: human holdout, the blind definitive 60 dishes, scored once after the build was frozen. Reported apart from every other result.";

/** A part's dishes, checked: the holdout's own checks, then the part's ids and its exact size. */
export function checkSeries(value: unknown, series: Series): HumanDish[] {
  const dishes = checkHumanDishes(value);
  const { dishes: size, prefix } = SERIES[series];
  const problems: string[] = [];
  const wrong = dishes.filter((d) => !d.id.startsWith(prefix)).map((d) => d.id);
  if (wrong.length > 0)
    problems.push(`ids not of the ${series} part (${prefix}…): ${wrong.join(", ")}`);
  if (dishes.length !== size)
    problems.push(`the ${series} part has ${size} dishes, this file ${dishes.length}`);
  if (problems.length > 0) throw new Error(`human holdout, ${series}:\n- ${problems.join("\n- ")}`);
  return dishes;
}

/** The full holdout from its two parts: ids disjoint, 40 + 60 = the minimum of 100. */
export function mergeSeries(exploratory: unknown, definitive: unknown): HumanDish[] {
  const a = checkSeries(exploratory, "exploratory");
  const b = checkSeries(definitive, "definitive");
  const all = [...a, ...b];
  if (new Set(all.map((d) => d.id)).size !== all.length)
    throw new Error("human holdout: an id is in both parts");
  if (all.length < HUMAN_HOLDOUT_MIN_DISHES)
    throw new Error(
      `human holdout: ${all.length} dishes, the minimum is ${HUMAN_HOLDOUT_MIN_DISHES}`,
    );
  return checkHumanDishes(all);
}

/** Dish cards and scenarios (each dish in English and in Dutch), as the full holdout makes them. */
function asSet(dishes: readonly HumanDish[]): { dishes: DishCard[]; scenarios: Scenario[] } {
  const labelled = (d: HumanDish) => (d.good?.length ?? 0) + (d.ok?.length ?? 0) > 0;
  return {
    dishes: dishes.map((d) => ({
      id: d.id,
      en: d.en,
      nl: d.nl,
      legacy: [],
      truth: d.truth,
      good: d.good ?? [],
      ok: d.ok ?? [],
      why: d.why ?? "",
    })),
    scenarios: dishes.flatMap((d) =>
      (["en", "nl"] as const).map((lang): Scenario => ({
        id: `${d.id}-${lang}`,
        category: "pairing-hard",
        lang,
        cellar: "all",
        turns: [{ user: lang === "en" ? d.question_en : d.question_nl }],
        dish: d.id,
        needs: ["pairing"],
        expect: labelled(d) ? { verdict: "auto" } : {},
      })),
    ),
  };
}

export const readSeal = (series: Series): HumanHoldoutSeal | null =>
  existsSync(SEAL_OF[series])
    ? (JSON.parse(readFileSync(SEAL_OF[series], "utf8")) as HumanHoldoutSeal)
    : null;

/**
 * One part as a set: read from its own escrowed file (outside the repository), checked against its own seal. Empty
 * when no path is given; refuses a missing seal, a file that does not match it, and a file that is not that part.
 */
export function humanPart(
  series: Series,
  env: Record<string, string | undefined> = process.env,
  seal: HumanHoldoutSeal | null = readSeal(series),
): { dishes: DishCard[]; scenarios: Scenario[] } {
  const path = env[series === "exploratory" ? HUMAN_EXPLORATORY_ENV : HUMAN_DEFINITIVE_ENV];
  if (!path) return { dishes: [], scenarios: [] };
  if (!seal)
    throw new Error(
      `human holdout, ${series}: no human-holdout/SEAL-${series}.json; seal the file first`,
    );
  const text = readEscrowed({ [HUMAN_HOLDOUT_ENV]: path }, seal);
  if (text === null) return { dishes: [], scenarios: [] };
  return asSet(checkSeries(JSON.parse(text), series));
}

// ---- The definitive part: only with the build frozen, and only once ------------------------------------------

export interface FrozenRecord {
  /** The commit the build was frozen at (full or abbreviated sha). */
  commit: string;
  frozenOn: string;
  /** Who froze it, by role (never a full name in the repository). */
  by: string;
}
export interface ScoredEntry {
  sealSha256: string;
  engine: string;
  frozenAt: string;
  scoredOn: string;
}

const isSha = (s: string) => /^[0-9a-f]{7,40}$/.test(s);
const sameCommit = (a: string, b: string) =>
  isSha(a) && isSha(b) && (a.startsWith(b) || b.startsWith(a));

/** Why the definitive part may not be scored now; null when it may. Pure, so it is tested without any file. */
export function definitiveRefusal(input: {
  definitive: boolean;
  frozenAt: string | undefined;
  head: string;
  /** Since the frozen commit only results were committed (results/, the freeze record itself). */
  onlyResultsSince?: boolean;
  frozen: FrozenRecord | null;
  scored: readonly ScoredEntry[];
  sealSha256: string | null;
  engine: string;
}): string | null {
  if (!input.definitive)
    return `"${DEFINITIVE_SET}" is the blind definitive holdout: it is scored only with --definitive and --frozen-at <sha>.`;
  if (!input.frozenAt || !isSha(input.frozenAt))
    return "--frozen-at <sha> is required: the commit the build was frozen at.";
  if (!input.frozen)
    return "no recorded freeze (results/p8-build-frozen.json): record the frozen commit first.";
  if (!sameCommit(input.frozen.commit, input.frozenAt))
    return `--frozen-at ${input.frozenAt} is not the recorded freeze (${input.frozen.commit}).`;
  if (!sameCommit(input.head, input.frozenAt) && !input.onlyResultsSince)
    return `the checked-out commit (${input.head.slice(0, 12)}) is not the frozen build (${input.frozenAt}).`;
  if (!input.sealSha256) return "no SEAL-definitive.json: the definitive part is not sealed.";
  if (input.scored.some((s) => s.sealSha256 === input.sealSha256 && s.engine === input.engine))
    return `this seal was already scored with ${input.engine}: the definitive part is scored only once.`;
  return null;
}

/** The record of scorings, read; an unreadable record refuses rather than allowing a second scoring. */
export function readScored(path: URL = SCORED_RECORD): ScoredEntry[] {
  if (!existsSync(path)) return [];
  const value = JSON.parse(readFileSync(path, "utf8")) as { scorings?: ScoredEntry[] };
  if (!Array.isArray(value.scorings))
    throw new Error("p8-definitive-scored.json cannot be read: refusing");
  return value.scorings;
}

/** Writes the scoring BEFORE the run starts: a run that crashes or stops has still used its one scoring. */
export function recordScoring(entry: ScoredEntry, path: URL = SCORED_RECORD): void {
  const scorings = [...readScored(path), entry];
  writeFileSync(path, JSON.stringify({ scorings }, null, 2) + "\n");
}

export const readFrozen = (path: URL = FROZEN_RECORD): FrozenRecord | null =>
  existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as FrozenRecord) : null;

/** The results folder, relative to the repository: the only place a commit after the freeze may touch. */
export const RESULTS_PATH = "docs/sprints/sommelier-3-mega/results/";

/**
 * Whether only results were committed since `frozen` (the freeze record, the paid runs' files): the build itself is
 * then still the frozen one. False when git cannot say.
 */
export function onlyResultsSince(frozen: string, cwd: string): boolean {
  try {
    const changed = execFileSync("git", ["diff", "--name-only", `${frozen}..HEAD`], {
      cwd,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    return changed.every((f) => f.startsWith(RESULTS_PATH));
  } catch {
    return false;
  }
}

/** Whether a scenario belongs to the definitive part (refused in any other set). */
export const isDefinitive = (scenarioId: string) => scenarioId.startsWith(SERIES.definitive.prefix);
