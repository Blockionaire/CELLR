import "server-only";
import { isStoredAnswer } from "@cellr/domain";
import type { ExchangeEntry, RecordedExchange } from "@/server/sommelier/types";
import { logError } from "@/server/log";
import { createServiceClient } from "./client";

/**
 * Keeps a question and the sommelier's answer in the person's conversation (migration 0046). Service role only:
 * people cannot write their own conversation, so what is kept as the answer is exactly what this server answered.
 * The person is the signed-in user of this request (from the verified session, never from the client) and the
 * household is their active one; the database checks they belong to it.
 *
 * Never fails the question: the answer has already been given (and paid for). Null when it could not be kept: no
 * service key, the database step not taken yet, or any other failure (logged with ids only).
 */
export async function recordSommelierExchange(
  entry: ExchangeEntry,
): Promise<RecordedExchange | null> {
  const db = createServiceClient();
  if (!db) return null;
  try {
    const { data, error } = await db.rpc("sommelier_record_exchange", {
      p_user_id: entry.userId,
      p_household_id: entry.householdId,
      p_question_id: entry.questionId,
      p_question: entry.question,
      p_answer: entry.answer as never,
      p_model: entry.model as string,
      p_question_kind: entry.questionKind,
    });
    if (error) {
      // Before the database step (PGRST202: no such function) there is simply nothing to keep it in.
      if (error.code !== "PGRST202" && error.code !== "42883")
        logError("sommelier_exchange_not_kept", error, { code: error.code ?? null });
      return null;
    }
    const row = data as {
      conversationId?: unknown;
      messageId?: unknown;
      replayed?: unknown;
      answer?: unknown;
    } | null;
    if (typeof row?.conversationId !== "string" || typeof row.messageId !== "string") return null;
    return {
      conversationId: row.conversationId,
      messageId: row.messageId,
      replayed: row.replayed === true,
      answer: isStoredAnswer(row.answer) ? row.answer : null,
    };
  } catch (error) {
    logError("sommelier_exchange_not_kept", error);
    return null;
  }
}
