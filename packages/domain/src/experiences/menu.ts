import { composeDish, type FoodKnowledge } from "../food/compose";
import type { FoodMain, FoodProfile } from "../food/types";
import {
  assessPairing,
  type AssessedWine,
  type Assessment,
  type PairingCon,
} from "../pairing-engine/assess";
import {
  decidePairing,
  type PairingCandidate,
  type PairingDecision,
  type PairingPick,
} from "../pairing-engine/decide";

/**
 * PREMIUM EXPERIENCES built on the same engines: a wine for every course of a menu, what to cook with a bottle,
 * and which of two bottles suits a dish better. Nothing here decides anything the pairing engine would not.
 */

export interface CoursePlan<T> {
  food: FoodProfile;
  decision: PairingDecision<T>;
  /** The wine for this course, or null when nothing owned suits it. */
  pick: PairingPick<T> | null;
  /** True when the same wine is also poured with another course (because nothing else suits as well). */
  shared: boolean;
}

/**
 * One wine per course. Each course gets its best wine; where two courses want the same bottle, the course with
 * fewer good choices keeps it and the other takes its next wine of the same level, if it has one. A wine is
 * poured twice only when the alternative would be a worse match.
 */
export function planMenu<T>(
  courses: readonly FoodProfile[],
  candidates: readonly PairingCandidate<T>[],
  keyOf: (item: T) => string,
): CoursePlan<T>[] {
  const decisions = courses.map((food) => decidePairing(food, candidates, candidates.length));
  const chosen: Array<PairingPick<T> | null> = decisions.map(() => null);
  const taken = new Map<string, number>();
  // Courses with the fewest wines that suit choose first.
  const order = decisions
    .map((d, i) => ({ i, options: d.picks.length }))
    .sort((a, b) => a.options - b.options || a.i - b.i);
  for (const { i } of order) {
    const picks = decisions[i]!.picks;
    const best = picks[0];
    if (!best) continue;
    const free = picks.find(
      (p) => p.assessment.level === best.assessment.level && !taken.has(keyOf(p.item)),
    );
    const pick = free ?? best;
    chosen[i] = pick;
    taken.set(keyOf(pick.item), (taken.get(keyOf(pick.item)) ?? 0) + 1);
  }
  return courses.map((food, i) => ({
    food,
    decision: { ...decisions[i]!, picks: decisions[i]!.picks.slice(0, 3) },
    pick: chosen[i]!,
    shared: chosen[i] !== null && (taken.get(keyOf(chosen[i]!.item)) ?? 0) > 1,
  }));
}

export interface DishIdea {
  dish: FoodProfile;
  assessment: Assessment;
}
export interface WineToFood {
  /** Dishes from the knowledge that this wine suits well, best first, no more than two of one kind. */
  ideas: DishIdea[];
  /** What goes wrong most often with this wine: the kinds of dish to steer away from. */
  avoid: PairingCon[];
}

/** What to cook with a bottle: every dish the engine knows is assessed against the wine. */
export function dishesFor(wine: AssessedWine, k: FoodKnowledge, limit = 6): WineToFood {
  const assessed = k.dishes
    .map((template) => composeDish(template, k))
    .filter((dish) => dish.main !== null)
    .map((dish) => ({ dish, assessment: assessPairing(dish, wine) }));
  const perMain = new Map<FoodMain, number>();
  const ideas: DishIdea[] = [];
  for (const idea of assessed
    .filter((x) => x.assessment.level === "good")
    .sort(
      (a, b) =>
        b.assessment.score - a.assessment.score || a.dish.dishId!.localeCompare(b.dish.dishId!),
    )) {
    const main = idea.dish.main!;
    if ((perMain.get(main) ?? 0) >= 2) continue;
    perMain.set(main, (perMain.get(main) ?? 0) + 1);
    ideas.push(idea);
    if (ideas.length === limit) break;
  }
  const clashes = new Map<PairingCon, number>();
  for (const { assessment } of assessed)
    if (assessment.clash) clashes.set(assessment.clash, (clashes.get(assessment.clash) ?? 0) + 1);
  const avoid = [...clashes.entries()]
    .filter(([, n]) => n >= Math.max(3, assessed.length * 0.05))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([note]) => note);
  return { ideas, avoid };
}

export interface Comparison<T> {
  /** The better of the two for this dish, or null when the engine cannot tell them apart. */
  better: T | null;
  first: PairingPick<T>;
  second: PairingPick<T>;
}

/** Which of two wines suits a dish better. A different level decides; inside a level it takes a clear margin. */
export function compareForDish<T>(
  food: FoodProfile,
  first: PairingCandidate<T>,
  second: PairingCandidate<T>,
): Comparison<T> {
  const a: PairingPick<T> = {
    item: first.item,
    assessment: assessPairing(food, first.wine),
    tier: first.tier,
  };
  const b: PairingPick<T> = {
    item: second.item,
    assessment: assessPairing(food, second.wine),
    tier: second.tier,
  };
  const rank = { good: 0, acceptable: 1, neutral: 2, poor: 3 } as const;
  const byLevel = rank[a.assessment.level] - rank[b.assessment.level];
  const margin = a.assessment.score - b.assessment.score;
  const better =
    byLevel !== 0
      ? byLevel < 0
        ? a.item
        : b.item
      : Math.abs(margin) >= 4
        ? margin > 0
          ? a.item
          : b.item
        : null;
  return { better, first: a, second: b };
}
