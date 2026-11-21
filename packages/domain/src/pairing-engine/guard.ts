import type { FoodProfile } from "../food/types";
import { assessPairing, type AssessedWine, type PairingCon } from "./assess";

/**
 * VARIANT E: V1 CHOOSES, THE ENGINE ONLY OBJECTS (S11). Sommelier V1 with its model picks the wines; this guard
 * looks at those picks and flags one only for a hard clash the rules are sure of (tannin with fish, a dry wine with
 * a dessert, ...). It never picks, reorders or adds a wine, and it says nothing where it cannot be sure: no dish
 * read, a dish read with too little confidence, or a wine known by its colour alone.
 *
 * In S11 it runs in shadow mode only: what it would flag is counted, the answer is unchanged
 * (`docs/sprints/sommelier-3-mega/V1PLUS_ARCHITECTURE.md`). Its settings were chosen on the main benchmark set
 * only, before the unseen sets were looked at, and are frozen with `GUARD_VERSION`.
 */
export const GUARD_VERSION = 1;

export interface GuardSettings {
  /** The least confidence in the dish's reading at which the guard says anything. */
  minConfidence: "high" | "medium";
}

/** Frozen for GUARD_VERSION 1 (see `progress/S11.md` §2 for the study it was chosen from). */
export const GUARD_SETTINGS: GuardSettings = { minConfidence: "medium" };

export interface GuardCandidate<T> {
  item: T;
  wine: AssessedWine;
}

export interface GuardVerdict<T> {
  /** False when the guard had nothing it could judge by: no dish, or not read well enough. */
  considered: boolean;
  /** Picks the guard would hold back, in the order they were offered, each with the clash it saw. */
  flagged: Array<{ item: T; index: number; clash: PairingCon }>;
}

const RANK = { low: 0, medium: 1, high: 2 } as const;

/** What the guard would say about picks someone else made for this dish. Pure; reads nothing else. */
export function guardPicks<T>(
  food: FoodProfile | null,
  picks: readonly GuardCandidate<T>[],
  settings: GuardSettings = GUARD_SETTINGS,
): GuardVerdict<T> {
  if (!food || food.main === null || RANK[food.confidence] < RANK[settings.minConfidence])
    return { considered: false, flagged: [] };
  const flagged: GuardVerdict<T>["flagged"] = [];
  picks.forEach((p, index) => {
    // A wine known by its colour alone is a guess about its structure: never a reason to object.
    if (p.wine.colourOnly) return;
    const clash = assessPairing(food, p.wine).clash;
    if (clash) flagged.push({ item: p.item, index, clash });
  });
  return { considered: true, flagged };
}
