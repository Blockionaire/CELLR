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
  /**
   * When nothing suits: the wine that comes closest without clashing, if there is one. It is not a
   * recommendation and an answer must not present it as one ("nothing here really suits; this would not clash").
   */
  closest: PairingPick<T> | null;
  /** Every candidate with its assessment, best first: for "why not this one?" and for tests. */
  all: PairingPick<T>[];
}

const LEVEL_ORDER: Record<PairingLevel, number> = { good: 0, acceptable: 1, neutral: 2, poor: 3 };
/** How much taste can move a wine among others of its level, in points of the ordering score. */
export const TASTE_WEIGHT = 6;
/**
 * Among wines of one level, the wine a dish is known for comes before one that merely fits, unless the other
 * scores clearly higher: this many points of the ordering score.
 */
export const CLASSIC_FIRST = 8;

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
  // A dish that was not understood cannot be paired: the caller asks what is being eaten instead.
  if (food.main === null)
    return { outcome: "none", picks: [], confidence: "low", closest: null, all: [] };
  const all = candidates
    .map((c, n) => ({
      pick: { item: c.item, assessment: assessPairing(food, c.wine), tier: c.tier },
      order: Math.max(-1, Math.min(1, c.taste ?? 0)) * TASTE_WEIGHT,
      // How far the wine's body is from the dish's weight: between equals, the closer one.
      apart: Math.abs(c.wine.structure.body - food.structure.weight),
      n,
    }))
    .map((x) => ({
      ...x,
      order: x.order + (x.pick.assessment.pros.includes("classic") ? CLASSIC_FIRST : 0),
    }))
    .sort(
      (a, b) =>
        LEVEL_ORDER[a.pick.assessment.level] - LEVEL_ORDER[b.pick.assessment.level] ||
        b.pick.assessment.score + b.order - (a.pick.assessment.score + a.order) ||
        // Between equals: the wine the dish is known for, then the one with the least against it.
        Number(b.pick.assessment.pros.includes("classic")) -
          Number(a.pick.assessment.pros.includes("classic")) ||
        a.pick.assessment.cons.length - b.pick.assessment.cons.length ||
        a.apart - b.apart ||
        a.n - b.n,
    )
    .map((x) => x.pick);

  // Only wines of the best level there is: next to a good match an "it will do" is not a recommendation.
  const best = all[0]?.assessment.level ?? "poor";
  const picks =
    best === "good" || best === "acceptable"
      ? all.filter((p) => p.assessment.level === best).slice(0, limit)
      : [];
  const first = picks[0];
  const outcome: PairingOutcome = !first
    ? "none"
    : first.assessment.level === "good"
      ? "good"
      : "acceptable";

  // As sure as the least-known wine it puts forward; "nothing suits" is as sure as the least-known wine that
  // was turned down.
  const wines = (first ? picks : all).reduce<Confidence>(
    (c, p) => least(c, TIER_CONFIDENCE[p.tier]),
    "high",
  );
  const closest =
    outcome === "none" ? (all.find((p) => p.assessment.level === "neutral") ?? null) : null;
  return { outcome, picks, confidence: least(food.confidence, wines), closest, all };
}
