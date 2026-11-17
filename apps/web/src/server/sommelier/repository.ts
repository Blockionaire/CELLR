import "server-only";
import {
  isStoredAnswer,
  SOMMELIER_RATINGS,
  type SavedSommelierMessage,
  type SommelierRating,
} from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { isMissingTable, mapDbError } from "@/server/db/errors";
import type { SommelierConversationRepository } from "./types";

const isRating = (value: unknown): value is SommelierRating =>
  (SOMMELIER_RATINGS as readonly unknown[]).includes(value);

export function createSommelierConversationRepository(db: Db): SommelierConversationRepository {
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
  };
}
