import type { FoodProfile } from "../food/types";
import { assessPairing, type AssessedWine, type Assessment, type PairingLevel } from "./assess";
import type { EvidenceTier } from "./wine";

/**
 * THE DECISION: a good match, an acceptable compromise, or no suitable wine. Suitability with the dish decides
 * the outcome and the order of levels. A person's taste only orders wines of the same level: it never turns an
 * acceptable wine into a good one, and never puts a poor wine in front of anyone.
 */

export const PAIRING_OUTCOMES = ["good", "acceptable", "none"] as const;
export type PairingOutcome = (typeof PAIRING_OUTCOMES)[number];

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export interface PairingCandidate<T> {
  item: T;
  wine: AssessedWine;
  tier: EvidenceTier;
  /**
   * How much this household likes wines like this one, from -1 (avoids) to 1 (loves); 0 when nothing is known.
   * Only used to order wines the dish already agrees with.
   */
  taste?: number;
}

export interface PairingPick<T> {
  item: T;
  assessment: Assessment;
  tier: EvidenceTier;
}

export interface PairingDecision<T> {
  outcome: PairingOutcome;
  /** At most `limit` wines, best first; never a poor one. Empty when nothing suits. */
  picks: PairingPick<T>[];
  /** How sure the engine is of this answer, in words. Follows from how well the dish and the wines are known. */
  confidence: Confidence;
  /** Every candidate with its assessment, best first: for "why not this one?" and for tests. */
  all: PairingPick<T>[];
}

const LEVEL_ORDER: Record<PairingLevel, number> = { good: 0, acceptable: 1, poor: 2 };
/** How much taste can move a wine among others of its level, in points of the ordering score. */
export const TASTE_WEIGHT = 6;

const TIER_CONFIDENCE: Record<EvidenceTier, Confidence> = {
  exact: "high",
  appellation: "medium",
  estimate: "low",
  unknown: "low",
};
const least = (a: Confidence, b: Confidence): Confidence =>
  CONFIDENCE_LEVELS[Math.min(CONFIDENCE_LEVELS.indexOf(a), CONFIDENCE_LEVELS.indexOf(b))]!;

export function decidePairing<T>(
  food: FoodProfile,
  candidates: readonly PairingCandidate<T>[],
  limit = 3,
): PairingDecision<T> {
  const all = candidates
    .map((c, n) => ({
      pick: { item: c.item, assessment: assessPairing(food, c.wine), tier: c.tier },
      order: Math.max(-1, Math.min(1, c.taste ?? 0)) * TASTE_WEIGHT,
      n,
    }))
    .sort(
      (a, b) =>
        LEVEL_ORDER[a.pick.assessment.level] - LEVEL_ORDER[b.pick.assessment.level] ||
        b.pick.assessment.score + b.order - (a.pick.assessment.score + a.order) ||
        a.n - b.n,
    )
    .map((x) => x.pick);

  const picks = all.filter((p) => p.assessment.level !== "poor").slice(0, limit);
  const first = picks[0];
  const outcome: PairingOutcome = !first
    ? "none"
    : first.assessment.level === "good"
      ? "good"
      : "acceptable";

  // "Nothing suits" is only as sure as the least-known wine that was turned down.
  const wines: Confidence = first
    ? TIER_CONFIDENCE[first.tier]
    : all.reduce<Confidence>((c, p) => least(c, TIER_CONFIDENCE[p.tier]), "high");
  return { outcome, picks, confidence: least(food.confidence, wines), all };
}
