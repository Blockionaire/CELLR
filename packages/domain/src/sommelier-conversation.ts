import { z } from "zod";
import { cellarQuestionKind, isCellarQuestion } from "./cellar-facts";
import { readPlan } from "./sommelier-plan";
import { detectIntent, type SommelierAnswer } from "./sommelier";

/**
 * THE SOMMELIER'S MEMORY. The general sommelier keeps one conversation per person: it is there again after the
 * person looked at a wine, closed the app, or came back the next day, and it is gone 7 days after it was last used
 * or as soon as they start a new one (migration 0046 holds the rules). Each answer in it can be rated, once per
 * person, as useful or not: for the quality of the sommelier, never to change what it says.
 *
 * Tonight's pairing conversation is not kept: it is about this evening.
 */

// ---- What kind of question it was (for the quality numbers) ---------------------------------------------------

export const SOMMELIER_QUESTION_KINDS = [
  "cellar_location",
  "cellar_quantity",
  "cellar_selection",
  "pairing",
  "occasion",
  "general",
] as const;
export type SommelierQuestionKind = (typeof SOMMELIER_QUESTION_KINDS)[number];

/**
 * The kind of question, told apart the way the sommelier itself tells them apart: a question about the cellar
 * (where, how many, which), a dish to pair, an evening, or anything else.
 */
export function sommelierQuestionKind(question: string): SommelierQuestionKind {
  if (isCellarQuestion(question)) return `cellar_${cellarQuestionKind(question)}`;
  const { dish, occasion } = detectIntent(question);
  if (dish !== null) return "pairing";
  if (occasion !== "anything") return "occasion";
  return "general";
}

// ---- Rating an answer -----------------------------------------------------------------------------------------

export const SOMMELIER_RATINGS = ["positive", "negative"] as const;
export type SommelierRating = (typeof SOMMELIER_RATINGS)[number];

/** PUT /sommelier/feedback: a rating for one of the person's own answers; null takes it back. */
export const RateSommelierAnswerSchema = z.object({
  messageId: z.uuid(),
  rating: z.enum(SOMMELIER_RATINGS).nullable(),
});
export type RateSommelierAnswer = z.infer<typeof RateSommelierAnswerSchema>;

// ---- What came of a bottle (Sommelier 3.0, S7) ----------------------------------------------------------------

/**
 * How a wine and the dish went together, said by someone who had them together. A thumb on the answer is another
 * thing (the answer was useful) and is never read as this.
 */
export const PAIRING_ENJOYED = ["yes", "mixed", "no"] as const;
export type PairingEnjoyed = (typeof PAIRING_ENJOYED)[number];

/**
 * What a person says came of one bottle an answer offered. Three separate things: they opened it (the outcome
 * exists), they had it with the dish (`withDish`), and how the two went together (`enjoyed`, only with the dish).
 */
export interface SommelierOutcome {
  vintageId: string;
  withDish: boolean | null;
  enjoyed: PairingEnjoyed | null;
}

/** PUT /sommelier/outcomes. `opened: false` takes everything said about the bottle back. */
export const SetSommelierOutcomeSchema = z
  .object({
    messageId: z.uuid(),
    vintageId: z.uuid(),
    opened: z.boolean(),
    withDish: z.boolean().nullable().default(null),
    enjoyed: z.enum(PAIRING_ENJOYED).nullable().default(null),
  })
  .refine((o) => o.enjoyed === null || o.withDish === true, {
    message: "how it went together can only be said by someone who had the wine with the dish",
    path: ["enjoyed"],
  })
  .refine((o) => o.opened || (o.withDish === null && o.enjoyed === null), {
    message: "a bottle that was not opened has no outcome",
    path: ["opened"],
  });
export type SetSommelierOutcome = z.infer<typeof SetSommelierOutcomeSchema>;

// ---- The kept conversation ------------------------------------------------------------------------------------

/** Where an answer is kept: the conversation and the answer's own id (what a rating is for). */
export interface SavedAnswerRef {
  conversationId: string;
  messageId: string;
}

/**
 * The sommelier's answer as POST /sommelier returns it. Asked with a `questionId` in the general chat, `saved`
 * says where it is kept, or is null when it could not be (it is then shown, but not there next time).
 */
export type SommelierReply = SommelierAnswer & { saved?: SavedAnswerRef | null };

export type SavedSommelierMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      answer: SommelierAnswer;
      rating: SommelierRating | null;
      /** What the person said came of the bottles this answer offered (only with `sommelier_learning`). */
      outcomes?: SommelierOutcome[];
    };

export interface SavedSommelierConversation {
  id: string;
  /** When its last question was asked (ISO): it is gone SOMMELIER_CONVERSATION_DAYS after that. */
  lastActivityAt: string;
  /** Oldest first: each question followed by its answer. */
  messages: SavedSommelierMessage[];
}

/** A kept conversation lives this long after its last question (the database enforces it: migration 0046). */
export const SOMMELIER_CONVERSATION_DAYS = 7;

/** GET /sommelier/conversation: the person's conversation, or null when there is none to continue. */
export interface SommelierConversationView {
  conversation: SavedSommelierConversation | null;
}

/** A kept answer still has the shape the screen draws (anything else is left out rather than drawn wrongly). */
export function isStoredAnswer(value: unknown): value is SommelierAnswer {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    (a.source === "ai" || a.source === "basic") &&
    Array.isArray(a.bottles) &&
    (a.text === null || typeof a.text === "string") &&
    (a.basic === null || typeof a.basic === "string") &&
    // A kept plan is drawn as it is (links included), so it must be one; anything else is not drawn.
    (a.plan === undefined || a.plan === null || readPlan(a.plan) !== null) &&
    (a.otherBottles === undefined || Array.isArray(a.otherBottles))
  );
}
