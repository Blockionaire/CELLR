import { z } from "zod";
import type { FoodProfile } from "../food/types";
import type { PairingDecision, PairingPick } from "./decide";
import type { WineStructure } from "./wine";

/**
 * A SECOND OPINION IN A CLOSE CALL (S10, an experiment: switch `sommelier_second_opinion`). When the engine is
 * not sure (the dish was read by a model, the reading is not sure, the best it found is only "acceptable", or the
 * first two are almost level), a model may look at the engine's own picks and put them in another order, leave
 * one out, or say none of them suits. It cannot add a wine, raise a level, or see more than the picks: what it is
 * shown is the dish (as the engine read it) and each pick as a style (colour, grapes or place, structure), never
 * a producer, a name, a price or anything about the household.
 *
 * Its answer is checked here: only refs it was given, each once. Whatever it says, the result is a subset of the
 * engine's picks in some order, so the second opinion can only make an answer more careful, never more daring.
 */
export const REVIEW_REASONS = [
  "agree",
  "better-first",
  "clash",
  "dish-uncertain",
  "nothing-suits",
] as const;

export const RawPairingReviewSchema = z
  .object({
    order: z.array(z.string().max(4)).max(3),
    drop: z.array(z.string().max(4)).max(3),
    none_suits: z.boolean(),
    reason: z.enum(REVIEW_REASONS),
  })
  .strict();
export type RawPairingReview = z.infer<typeof RawPairingReviewSchema>;

export interface ReviewCandidate {
  ref: string;
  type: string;
  /** What the wine is known as, as the engine reads it: grapes, places, styles. No producer, no name. */
  keys: string[];
  structure: Pick<WineStructure, "body" | "tannin" | "acidity" | "sweetness" | "oak">;
  fizz: boolean;
  level: "good" | "acceptable";
}

export interface ReviewInput {
  dish: {
    main: string;
    structure: FoodProfile["structure"];
    tags: string[];
    readBy: "parser" | "model";
  };
  candidates: ReviewCandidate[];
}

export interface PairingReview {
  /** The refs to keep, in the order to offer them. Empty: none suits. */
  keep: string[];
  reason: (typeof REVIEW_REASONS)[number];
}

/** Within this many points of the first, the second pick is a close call. */
export const CLOSE_CALL_POINTS = 5;

/** Whether the engine's decision is a close call worth a second opinion. */
export function isCloseCall<T>(decision: PairingDecision<T>, food: FoodProfile): boolean {
  const [first, second] = decision.picks;
  if (!first) return false;
  return (
    food.readBy === "model" ||
    food.confidence !== "high" ||
    first.assessment.level !== "good" ||
    (second !== undefined && first.assessment.score - second.assessment.score < CLOSE_CALL_POINTS)
  );
}

/** The model's answer, checked against the refs it was given. Throws on an answer outside the schema. */
export function checkPairingReview(value: unknown, refs: readonly string[]): PairingReview {
  const raw = RawPairingReviewSchema.parse(value);
  const given = new Set(refs);
  const dropped = new Set(raw.drop.filter((r) => given.has(r)));
  if (raw.none_suits) return { keep: [], reason: "nothing-suits" };
  const ordered = raw.order.filter((r, i) => given.has(r) && raw.order.indexOf(r) === i);
  // A ref it did not put in order and did not drop keeps its place after the ordered ones.
  const rest = refs.filter((r) => !ordered.includes(r));
  return {
    keep: [...ordered, ...rest].filter((r) => !dropped.has(r)),
    reason: raw.reason,
  };
}

/** The engine's picks after a checked second opinion: a subset, in the reviewed order. */
export function applyPairingReview<T>(
  picks: readonly PairingPick<T>[],
  refs: readonly string[],
  review: PairingReview,
): PairingPick<T>[] {
  const byRef = new Map(refs.map((r, i) => [r, picks[i]!]));
  return review.keep.map((r) => byRef.get(r)).filter((p): p is PairingPick<T> => p !== undefined);
}

/** The strict JSON schema for the model's answer, with the refs of this call as a closed list. */
export function pairingReviewJsonSchema(refs: readonly string[]): Record<string, unknown> {
  const ref = { type: "string", enum: [...refs] };
  return {
    type: "object",
    additionalProperties: false,
    required: ["order", "drop", "none_suits", "reason"],
    properties: {
      order: { type: "array", items: ref, maxItems: 3 },
      drop: { type: "array", items: ref, maxItems: 3 },
      none_suits: { type: "boolean" },
      reason: { type: "string", enum: [...REVIEW_REASONS] },
    },
  };
}
