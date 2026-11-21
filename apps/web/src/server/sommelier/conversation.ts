import "server-only";
import {
  sommelierQuestionKind,
  type AskSommelier,
  type RateSommelierAnswer,
  type SetSommelierOutcome,
  type SommelierOutcome,
  type SommelierAnswer,
  type SommelierConversationView,
  type SommelierRating,
  type SommelierReply,
  type GuardShadowCounts,
  findMentions,
} from "@cellr/domain";
import type { SommelierObserver } from "./service";
import type { ExchangeEntry, RecordedExchange, SommelierConversationRepository } from "./types";
import { shadowCounts, type GuardShadow } from "./v1-guard";

export interface SommelierChatDeps {
  /**
   * The sommelier itself (unchanged): it answers; `observe.model` hears which model wrote an AI answer, `observe.guard`
   * what variant E's guard would have held back (shadow mode).
   */
  ask: (request: AskSommelier, observe: Required<SommelierObserver>) => Promise<SommelierAnswer>;
  /** Reads, deletes and ratings as the signed-in person (row-level security). */
  repo: SommelierConversationRepository;
  /** Keeps a question and its answer (service role, for this request's verified person); null when it could not. */
  record: (entry: Omit<ExchangeEntry, "userId">) => Promise<RecordedExchange | null>;
  userId: string;
  householdId: () => Promise<string>;
  /**
   * The social sommelier is switched on: a question that names a friend is then answered and not kept. Without
   * it an "@" in a question is the person's own text, kept as it always was.
   */
  social?: boolean;
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
      // What variant E's guard would have done (shadow mode): counts only, with this answer and never kept.
      let shadow: GuardShadowCounts | null = null;
      const guard = (g: GuardShadow) => (shadow = shadowCounts(g));
      const withShadow = <T extends SommelierReply>(reply: T): T =>
        shadow ? { ...reply, shadow } : reply;
      if (!questionId || (request.mode ?? "chat") !== "chat")
        return withShadow(await deps.ask(request, { model: () => {}, guard }));

      // Without a household nothing is kept or brought back; the sommelier itself says what it can.
      const householdId = await deps.householdId().catch(() => null);
      if (!householdId)
        return withShadow({
          ...(await deps.ask(request, { model: () => {}, guard })),
          saved: null,
        });

      // Already answered (a retry of a question that did reach us): the kept answer, no second call. Only from the
      // live conversation in this household (the database decides what is alive and theirs).
      const kept = await deps.repo.findExchange(householdId, questionId).catch(() => null);
      if (kept)
        return {
          ...kept.answer,
          saved: { conversationId: kept.conversationId, messageId: kept.messageId },
        };

      let model: string | null = null;
      const answer = await deps.ask(request, { model: (id) => (model = id), guard });
      const question = request.messages.at(-1)!.text;
      // A question that names a friend is answered and then forgotten: neither the question (it holds their
      // name) nor the answer (it was shaped by what they allowed at that moment) is kept. So when a friend
      // withdraws their consent, or the friendship ends, there is nothing stored to take back.
      // Only with the social switch on: without it nobody is looked up, and "what do I open @home tonight" is
      // kept like any other question.
      if (
        deps.social === true &&
        (findMentions(question).length > 0 || (answer.plan?.friends.length ?? 0) > 0)
      )
        return withShadow({ ...answer, saved: null });
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
      if (!saved) return withShadow({ ...answer, saved: null });
      const ref = { conversationId: saved.conversationId, messageId: saved.messageId };
      // The same question reached us twice at once and the other one was kept first: that is the answer.
      if (saved.replayed && saved.answer) return { ...saved.answer, saved: ref };
      return withShadow({ ...answer, saved: ref });
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

    /**
     * What came of a bottle an answer offered: opened, had with the dish, how the two went together. Its own
     * record, never a rating of the answer and never derived from one.
     */
    async outcome(input: SetSommelierOutcome): Promise<{ outcome: SommelierOutcome | null }> {
      return { outcome: await deps.repo.setOutcome(input) };
    },
  };
}

export type SommelierChatService = ReturnType<typeof createSommelierChatService>;
