import { existsSync, readFileSync } from "node:fs";
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
 * THE HUMAN HOLDOUT IN TWO SERIES (P8; the owner's provisional target of 2026-11-24): 100 independent dishes, written
 * as a first series of 40 and a second series of 60. Series 2 is written by people who have not seen any result on
 * series 1. The full set (100, `human`) keeps its own escrow and its minimum of 100 (human-holdout.ts, unchanged).
 *
 * "SERIES 1 ONLY (40)" is a separate, explicitly named set, `human-series1`: its own escrowed file
 * (SOMMELIER_EVAL_HUMAN_SERIES1_FILE), its own seal (human-holdout/SEAL-series1.json), exactly 40 dishes with ids
 * `hh-s1-…`, blind like the full set, and every report of it is marked PROVISIONAL: 40 dishes cannot show
 * non-inferiority at −5 points (docs/sprints/sommelier-3-mega/P8_POWER_ANALYSIS.md).
 */
export const SERIES = {
  1: { dishes: 40, prefix: "hh-s1-" },
  2: { dishes: 60, prefix: "hh-s2-" },
} as const;
export type Series = keyof typeof SERIES;

export const HUMAN_SERIES1_ENV = "SOMMELIER_EVAL_HUMAN_SERIES1_FILE";
export const HUMAN_SERIES1_SEAL = new URL("./human-holdout/SEAL-series1.json", import.meta.url);
export const SERIES1_SET = "human-series1";

/** Printed above, and recorded in, every report of the series-1-only set. */
export const PROVISIONAL_NOTE =
  "PROVISIONAL: human holdout series 1 only (40 of the planned 100 dishes). 40 dishes cannot show non-inferiority at -5 points; they can only catch a large regression (P8_POWER_ANALYSIS.md). Not a release measurement.";

/** A series' dishes, checked: the holdout's own checks, then the series' ids and its exact size. */
export function checkSeries(value: unknown, series: Series): HumanDish[] {
  const dishes = checkHumanDishes(value);
  const { dishes: size, prefix } = SERIES[series];
  const problems: string[] = [];
  const wrong = dishes.filter((d) => !d.id.startsWith(prefix)).map((d) => d.id);
  if (wrong.length > 0)
    problems.push(`ids not of series ${series} (${prefix}…): ${wrong.join(", ")}`);
  if (dishes.length !== size)
    problems.push(`series ${series} has ${size} dishes, this file ${dishes.length}`);
  if (problems.length > 0)
    throw new Error(`human holdout series ${series}:\n- ${problems.join("\n- ")}`);
  return dishes;
}

/** The full holdout from its two series: ids disjoint, 40 + 60 = the minimum of 100. */
export function mergeSeries(one: unknown, two: unknown): HumanDish[] {
  const a = checkSeries(one, 1);
  const b = checkSeries(two, 2);
  const all = [...a, ...b];
  if (new Set(all.map((d) => d.id)).size !== all.length)
    throw new Error("human holdout: an id is in both series");
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

/**
 * The series-1-only set: read from SOMMELIER_EVAL_HUMAN_SERIES1_FILE (outside the repository) and checked against
 * its own seal. Empty when no path is given; refuses a missing seal, a file that does not match it, and a file that
 * is not exactly series 1.
 */
export function humanSeries1(
  env: Record<string, string | undefined> = process.env,
  seal: HumanHoldoutSeal | null = existsSync(HUMAN_SERIES1_SEAL)
    ? (JSON.parse(readFileSync(HUMAN_SERIES1_SEAL, "utf8")) as HumanHoldoutSeal)
    : null,
): { dishes: DishCard[]; scenarios: Scenario[] } {
  const path = env[HUMAN_SERIES1_ENV];
  if (!path) return { dishes: [], scenarios: [] };
  if (!seal)
    throw new Error(
      "human holdout series 1: no human-holdout/SEAL-series1.json; seal the file first",
    );
  const text = readEscrowed({ [HUMAN_HOLDOUT_ENV]: path }, seal);
  if (text === null) return { dishes: [], scenarios: [] };
  return asSet(checkSeries(JSON.parse(text), 1));
}
