import { DISHES } from "./dishes";
import { SCENARIOS } from "./scenarios";
import type { DishCard, Scenario } from "./types";

/**
 * THE SCENARIO SETS. "main" is the benchmark the engines were developed against (246 scenarios). Other sets are
 * registered here as they are added; a set that was written blind to the engines is only ever measured, never
 * used to develop a rule.
 */
const SETS: Record<string, { scenarios: readonly Scenario[]; dishes: readonly DishCard[] }> = {
  main: { scenarios: SCENARIOS, dishes: DISHES },
};

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
