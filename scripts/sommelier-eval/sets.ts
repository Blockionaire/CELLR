import { DISHES } from "./dishes";
import { HOLDOUT_DISHES } from "./dishes-holdout";
import { humanHoldout } from "./human-holdout";
import { humanSeries1 } from "./human-holdout-series";
import { SCENARIOS } from "./scenarios";
import { HOLDOUT_SCENARIOS } from "./scenarios-holdout";
import type { DishCard, Scenario } from "./types";

/**
 * THE SCENARIO SETS. "main" is the benchmark the engines were developed against (246 scenarios). Other sets are
 * registered here as they are added; a set that was written blind to the engines is only ever measured, never
 * used to develop a rule.
 */
const SETS: Record<string, { scenarios: readonly Scenario[]; dishes: readonly DishCard[] }> = {
  main: { scenarios: SCENARIOS, dishes: DISHES },
  /**
   * Written in S9 by an agent that saw the benchmark's contract and the 30 wines and nothing of the engines,
   * their results or their documents: 44 dishes that are not in "main", every one labelled against all 30
   * wines, and 88 pairing scenarios. Measured as a whole before and after the S9 changes. It contains the blind
   * half below, so it is only ever reported in totals.
   */
  holdout: { scenarios: HOLDOUT_SCENARIOS, dishes: HOLDOUT_DISHES },
  /**
   * The holdout split in two by the order of its dishes, after its first measurement (in totals) showed how
   * little of the development set's gain carried over. "holdout-dev": the first 22 dishes; its failures were
   * read, and rules of S9 answer to some of them (so it is no longer unseen). "holdout-test": the other 22; only
   * ever measured in totals. No tool lists it scenario by scenario, no recorded result names its scenarios, and
   * its test compares totals only.
   */
  "holdout-dev": half(0),
  "holdout-test": half(1),
  /**
   * S10: at least 100 dishes written by people (human-holdout.ts). Empty until the file is written; blind from
   * the moment it exists.
   */
  human: humanHoldout(),
  /**
   * P8: the human holdout's first series alone (40 dishes, human-holdout-series.ts), its own escrow and seal. Blind,
   * and every report of it is marked PROVISIONAL: it is not the 100 the full set needs.
   */
  "human-series1": humanSeries1(),
};
function half(which: 0 | 1) {
  const middle = Math.floor(HOLDOUT_DISHES.length / 2);
  const dishes = which === 0 ? HOLDOUT_DISHES.slice(0, middle) : HOLDOUT_DISHES.slice(middle);
  const ids = new Set(dishes.map((d) => d.id));
  return { dishes, scenarios: HOLDOUT_SCENARIOS.filter((s) => s.dish && ids.has(s.dish)) };
}
/** Sets whose failures are not to be read one by one: they are the blind measure. */
export const BLIND_SETS: ReadonlySet<string> = new Set(["holdout-test", "human", "human-series1"]);
/** Whether a set is blind or holds a blind set's scenarios ("holdout" holds "holdout-test"): totals only. */
export function holdsBlind(name: string): boolean {
  if (BLIND_SETS.has(name)) return true;
  const blind = new Set(
    [...BLIND_SETS].flatMap((b) => (SETS[b]?.scenarios ?? []).map((x) => x.id)),
  );
  return scenariosOf(name).some((x) => blind.has(x.id));
}

export const SET_NAMES = () => Object.keys(SETS);
export function registerSet(
  name: string,
  set: { scenarios: readonly Scenario[]; dishes: readonly DishCard[] },
) {
  SETS[name] = set;
}
export function scenariosOf(name: string): readonly Scenario[] {
  const set = SETS[name];
  if (!set) throw new Error(`unknown set "${name}"; known: ${Object.keys(SETS).join(", ")}`);
  return set.scenarios;
}
export function cardsOf(name: string): ReadonlyMap<string, DishCard> {
  const set = SETS[name];
  if (!set) throw new Error(`unknown set "${name}"; known: ${Object.keys(SETS).join(", ")}`);
  return new Map(set.dishes.map((d) => [d.id, d]));
}

/** Every dish card of every set, by id (the main set's and the holdout's ids do not overlap). */
let every: ReadonlyMap<string, DishCard> | null = null;
export function anyCard(id: string): DishCard | null {
  every ??= new Map(
    Object.values(SETS).flatMap((set) => set.dishes.map((d) => [d.id, d] as const)),
  );
  return every.get(id) ?? null;
}
