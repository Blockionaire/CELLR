import "server-only";
import {
  sommelierQuestionKind,
  type AskSommelier,
  type RateSommelierAnswer,
  type SommelierAnswer,
  type SommelierConversationView,
  type SommelierRating,
  type SommelierReply,
} from "@cellr/domain";
import type { ExchangeEntry, RecordedExchange, SommelierConversationRepository } from "./types";

export interface SommelierChatDeps {
  /** The sommelier itself (unchanged): it answers; `observe.model` hears which model wrote an AI answer. */
  ask: (
    request: AskSommelier,
    observe: { model: (id: string) => void },
  ) => Promise<SommelierAnswer>;
  /** Reads, deletes and ratings as the signed-in person (row-level security). */
  repo: SommelierConversationRepository;
  /** Keeps a question and its answer (service role, for this request's verified person); null when it could not. */
  record: (entry: Omit<ExchangeEntry, "userId">) => Promise<RecordedExchange | null>;
  userId: string;
  householdId: () => Promise<string>;
}

/**
 * The general sommelier's conversation, kept for the person (migration 0046): the question and its answer are kept
 * after the answer is given, so nothing half-asked is ever kept, and a question sent again with the same id gets
 * the kept answer back without asking the model again. What the model hears is unchanged: the recent conversation
 * the screen sends. Keeping it can fail without the person losing the answer.
 */
export function createSommelierChatService(deps: SommelierChatDeps) {
  return {
    async ask(request: AskSommelier): Promise<SommelierReply> {
      const questionId = request.questionId;
      // Tonight, or a caller that does not keep a conversation: the sommelier as it always was.
      if (!questionId || (request.mode ?? "chat") !== "chat")
        return deps.ask(request, { model: () => {} });

      // Without a household nothing is kept or brought back; the sommelier itself says what it can.
      const householdId = await deps.householdId().catch(() => null);
      if (!householdId) return { ...(await deps.ask(request, { model: () => {} })), saved: null };

      // Already answered (a retry of a question that did reach us): the kept answer, no second call. Only from the
      // live conversation in this household (the database decides what is alive and theirs).
      const kept = await deps.repo.findExchange(householdId, questionId).catch(() => null);
      if (kept)
        return {
          ...kept.answer,
          saved: { conversationId: kept.conversationId, messageId: kept.messageId },
        };

      let model: string | null = null;
      const answer = await deps.ask(request, { model: (id) => (model = id) });
      const question = request.messages.at(-1)!.text;
      const saved = await deps
        .record({
          householdId,
          questionId,
          question,
          answer,
          model: answer.source === "ai" ? model : null,
          questionKind: sommelierQuestionKind(question),
        })
        .catch(() => null);
      if (!saved) return { ...answer, saved: null };
      const ref = { conversationId: saved.conversationId, messageId: saved.messageId };
      // The same question reached us twice at once and the other one was kept first: that is the answer.
      if (saved.replayed && saved.answer) return { ...saved.answer, saved: ref };
      return { ...answer, saved: ref };
    },

    /** The conversation to continue: the person's own, in their active household, used in the last 7 days. */
    async current(): Promise<SommelierConversationView> {
      return { conversation: await deps.repo.current(await deps.householdId()) };
    },

    /** "New conversation": the kept one is deleted, so its words are never sent to the model again. */
    async clear(): Promise<void> {
      await deps.repo.clear(deps.userId);
    },

    async rate(input: RateSommelierAnswer): Promise<{ rating: SommelierRating | null }> {
      return { rating: await deps.repo.rate(input.messageId, input.rating) };
    },
  };
}

export type SommelierChatService = ReturnType<typeof createSommelierChatService>;
