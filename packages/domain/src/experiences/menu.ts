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
 * One wine per course. Each course may take any wine of its best level; among all such ways the one that pours
 * the fewest wines twice is chosen, and among those the one closest to each course's own first choice. So a wine
 * is poured twice only when every other way would give some course a worse match.
 */
export function planMenu<T>(
  courses: readonly FoodProfile[],
  candidates: readonly PairingCandidate<T>[],
  keyOf: (item: T) => string,
): CoursePlan<T>[] {
  const decisions = courses.map((food) => decidePairing(food, candidates, candidates.length));
  // Per course: the wines that suit it as well as its best one does (never a worse level to avoid a repeat).
  const options = decisions.map((d) => {
    const best = d.picks[0];
    return best ? d.picks.filter((p) => p.assessment.level === best.assessment.level) : [];
  });
  // Few courses and few wines of the best level each: every way is tried, with a cap so no menu can cost much.
  let budget = 20_000;
  let bestCost = Infinity;
  let bestChoice: number[] = options.map(() => 0);
  const choice: number[] = options.map(() => 0);
  const used = new Map<string, number>();
  const search = (i: number, repeats: number, rank: number) => {
    if (budget-- <= 0) return;
    // A repeat weighs more than any sum of ranks can.
    const cost = repeats * 1_000 + rank;
    if (cost >= bestCost) return;
    if (i === options.length) {
      bestCost = cost;
      bestChoice = [...choice];
      return;
    }
    const picks = options[i]!;
    if (picks.length === 0) return search(i + 1, repeats, rank);
    for (let n = 0; n < picks.length; n++) {
      const key = keyOf(picks[n]!.item);
      const before = used.get(key) ?? 0;
      used.set(key, before + 1);
      choice[i] = n;
      search(i + 1, repeats + (before > 0 ? 1 : 0), rank + n);
      used.set(key, before);
    }
  };
  search(0, 0, 0);
  const chosen = options.map((picks, i) => picks[bestChoice[i]!] ?? null);
  const poured = new Map<string, number>();
  for (const pick of chosen)
    if (pick) poured.set(keyOf(pick.item), (poured.get(keyOf(pick.item)) ?? 0) + 1);
  return courses.map((food, i) => ({
    food,
    decision: { ...decisions[i]!, picks: decisions[i]!.picks.slice(0, 3) },
    pick: chosen[i]!,
    shared: chosen[i] !== null && (poured.get(keyOf(chosen[i]!.item)) ?? 0) > 1,
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
