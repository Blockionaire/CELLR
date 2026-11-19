import "server-only";
import type {
  SavedSommelierConversation,
  SetSommelierOutcome,
  SommelierAnswer,
  SommelierOutcome,
  SommelierQuestionKind,
  SommelierRating,
} from "@cellr/domain";

/** A question and its answer as the server keeps them (written with the service role, for the verified person). */
export interface ExchangeEntry {
  userId: string;
  householdId: string;
  questionId: string;
  question: string;
  answer: SommelierAnswer;
  /** The model that wrote an AI answer; null for a plain one. */
  model: string | null;
  questionKind: SommelierQuestionKind;
}

export interface RecordedExchange {
  conversationId: string;
  messageId: string;
  /** The question was already kept (sent twice): `answer` is the one kept the first time. */
  replayed: boolean;
  answer: SommelierAnswer | null;
}

/** Everything read as the signed-in person: row-level security decides what is theirs and still alive. */
export interface SommelierConversationRepository {
  /** Their conversation in this household; null when there is none (or before the 0046 database step). */
  current(householdId: string): Promise<SavedSommelierConversation | null>;
  /**
   * A question of theirs already answered and kept in their live conversation in this household, with its answer;
   * null otherwise (never from an expired conversation, another household, or one they deleted or left).
   */
  findExchange(
    householdId: string,
    questionId: string,
  ): Promise<{ conversationId: string; messageId: string; answer: SommelierAnswer } | null>;
  /** Deletes their conversation (its messages go with it; ratings stay). */
  clear(userId: string): Promise<void>;
  /** Rates one of their answers (null takes the rating back); the rating as it now stands. */
  rate(messageId: string, rating: SommelierRating | null): Promise<SommelierRating | null>;
  /**
   * Says what came of one bottle one of their answers offered, or takes it back; what now stands (null: nothing).
   * The database checks that the answer is theirs and alive and that it offered this bottle.
   */
  setOutcome(input: SetSommelierOutcome): Promise<SommelierOutcome | null>;
}
