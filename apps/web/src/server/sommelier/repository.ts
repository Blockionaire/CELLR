import "server-only";
import {
  isStoredAnswer,
  PAIRING_ENJOYED,
  SOMMELIER_RATINGS,
  type PairingEnjoyed,
  type SavedSommelierMessage,
  type SommelierOutcome,
  type SommelierRating,
} from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { DomainError } from "@cellr/domain";
import { isMissingFunction, isMissingTable, mapDbError } from "@/server/db/errors";
import type { SommelierConversationRepository } from "./types";

const isRating = (value: unknown): value is SommelierRating =>
  (SOMMELIER_RATINGS as readonly unknown[]).includes(value);

const isEnjoyed = (value: unknown): value is PairingEnjoyed =>
  (PAIRING_ENJOYED as readonly unknown[]).includes(value);

/** One outcome as the screen holds it; anything that is not one of ours is read as "not said". */
const toOutcome = (row: {
  vintage_id: string;
  with_dish: boolean | null;
  enjoyed: string | null;
}): SommelierOutcome => ({
  vintageId: row.vintage_id,
  withDish: row.with_dish,
  enjoyed: row.with_dish === true && isEnjoyed(row.enjoyed) ? row.enjoyed : null,
});

/**
 * `outcomes`: the `sommelier_learning` feature is on. Without it nothing about outcomes is read (no query, and no
 * dependence on the 0052 database step).
 */
export function createSommelierConversationRepository(
  db: Db,
  options: { outcomes?: boolean } = {},
): SommelierConversationRepository {
  return {
    async current(householdId) {
      // Row-level security: only the person's own, still alive, in a household they belong to.
      const { data: conversation, error } = await db
        .from("sommelier_conversations")
        .select("id, last_activity_at")
        .eq("household_id", householdId)
        .maybeSingle();
      if (error && isMissingTable(error)) return null;
      if (error) throw mapDbError(error);
      if (!conversation) return null;

      const [messages, ratings] = await Promise.all([
        db
          .from("sommelier_messages")
          .select("id, role, content, answer, reply_to")
          .eq("conversation_id", conversation.id)
          .order("seq"),
        db
          .from("sommelier_feedback")
          .select("message_id, rating")
          .eq("conversation_id", conversation.id),
      ]);
      if (messages.error) throw mapDbError(messages.error);
      if (ratings.error) throw mapDbError(ratings.error);
      const rated = new Map(ratings.data.map((r) => [r.message_id, r.rating]));
      // What came of the bottles these answers offered: the person's own (row-level security), and only for the
      // answers of this conversation. Before the 0052 database step there are none.
      const answerIds = messages.data.filter((m) => m.role === "assistant").map((m) => m.id);
      const said = new Map<string, SommelierOutcome[]>();
      // Asked for, and the database knows them: only then does an answer carry outcomes (and the screen offer to
      // say one). With the switch on before the 0052 step is taken, there is nothing to say anything to.
      let known = options.outcomes === true;
      if (options.outcomes && answerIds.length > 0) {
        const outcomes = await db
          .from("sommelier_outcomes")
          .select("message_id, vintage_id, with_dish, enjoyed")
          .in("message_id", answerIds);
        if (outcomes.error && !isMissingTable(outcomes.error)) throw mapDbError(outcomes.error);
        if (outcomes.error) known = false;
        for (const row of outcomes.data ?? [])
          said.set(row.message_id, [...(said.get(row.message_id) ?? []), toOutcome(row)]);
      }

      // Each question with its answer, in order. A question whose answer cannot be drawn is left out with it.
      const answers = new Map(
        messages.data.filter((m) => m.role === "assistant").map((m) => [m.reply_to, m]),
      );
      const out: SavedSommelierMessage[] = [];
      for (const q of messages.data) {
        if (q.role !== "user" || q.content === null) continue;
        const a = answers.get(q.id);
        if (!a || !isStoredAnswer(a.answer)) continue;
        const rating = rated.get(a.id);
        out.push({ id: q.id, role: "user", text: q.content });
        out.push({
          id: a.id,
          role: "assistant",
          answer: a.answer,
          rating: isRating(rating) ? rating : null,
          ...(known ? { outcomes: said.get(a.id) ?? [] } : {}),
        });
      }
      return { id: conversation.id, lastActivityAt: conversation.last_activity_at, messages: out };
    },

    async findExchange(householdId, questionId) {
      // Only from the live conversation in the household being asked in: row-level security shows only the
      // person's own, alive, in a household they still belong to; the household is narrowed here as well.
      const { data: conversation, error } = await db
        .from("sommelier_conversations")
        .select("id")
        .eq("household_id", householdId)
        .maybeSingle();
      if (error && isMissingTable(error)) return null;
      if (error) throw mapDbError(error);
      if (!conversation) return null;
      const { data, error: readError } = await db
        .from("sommelier_messages")
        .select("id, answer")
        .eq("conversation_id", conversation.id)
        .eq("reply_to", questionId)
        .maybeSingle();
      if (readError) throw mapDbError(readError);
      if (!data || !isStoredAnswer(data.answer)) return null;
      return { conversationId: conversation.id, messageId: data.id, answer: data.answer };
    },

    async clear(userId) {
      const { error } = await db.from("sommelier_conversations").delete().eq("user_id", userId);
      if (error && isMissingTable(error)) return;
      if (error) throw mapDbError(error);
    },

    async rate(messageId, rating) {
      // The rating is recorded against the kept answer (its model and kind of question), never against what a
      // client says about it: the database function reads those itself.
      const { data, error } = await db.rpc("sommelier_set_feedback", {
        p_message_id: messageId,
        ...(rating ? { p_rating: rating } : {}),
      });
      if (error) throw mapDbError(error);
      return isRating(data) ? data : null;
    },

    async setOutcome(input) {
      // What the answer was (its kind, outcome and confidence) is read from the kept answer by the database
      // function, as is whether it offered this bottle: nothing of that is taken from the client.
      const { data, error } = await db.rpc("sommelier_set_outcome", {
        p_message_id: input.messageId,
        p_vintage_id: input.vintageId,
        p_opened: input.opened,
        ...(input.withDish === null ? {} : { p_with_dish: input.withDish }),
        ...(input.enjoyed === null ? {} : { p_enjoyed: input.enjoyed }),
      });
      // The 0052 database step is not taken: there is nothing to say an outcome to (as with the switch off).
      if (error && isMissingFunction(error)) throw new DomainError("NOT_FOUND");
      if (error) throw mapDbError(error);
      if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
      const row = data as Record<string, unknown>;
      return typeof row.vintageId === "string"
        ? toOutcome({
            vintage_id: row.vintageId,
            with_dish: typeof row.withDish === "boolean" ? row.withDish : null,
            enjoyed: typeof row.enjoyed === "string" ? row.enjoyed : null,
          })
        : null;
    },
  };
}
