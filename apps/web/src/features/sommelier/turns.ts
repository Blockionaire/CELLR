import {
  CHAT_MESSAGE_MAX,
  SOMMELIER_CONVERSATION_DAYS,
  type SommelierAnswer,
  type SommelierConversationView,
  type SommelierRating,
} from "@cellr/domain";

/**
 * One step of a conversation on screen. In the general chat a question and its answer carry the ids they are kept
 * under (the question's is chosen here, before it is sent), and an answer carries the person's rating of it.
 */
export type Turn =
  | { role: "user"; text: string; id?: string | undefined }
  | {
      role: "sommelier";
      answer: SommelierAnswer;
      id?: string | undefined;
      rating?: SommelierRating | null;
    }
  | { role: "error"; message: string; retry: string; questionId?: string | undefined };

/** The general chat as the screen holds it, between visits (the query cache) and across them (the server). */
export interface ChatState {
  turns: Turn[];
  /** When the last kept question was asked (ms); null while nothing is kept. */
  lastAskedAt: number | null;
}

export const EMPTY_CHAT: ChatState = { turns: [], lastAskedAt: null };

/**
 * A kept conversation is gone 7 days after its last question. The server already hides it then; this is for a screen
 * (or an app) that stayed open that long: its copy is gone too, and is never sent to the model again.
 */
export const chatExpired = (state: ChatState | undefined, now: number) =>
  state?.lastAskedAt != null && now - state.lastAskedAt > SOMMELIER_CONVERSATION_DAYS * 86_400_000;

/** The kept conversation, as turns. */
export const chatStateFrom = (view: SommelierConversationView): ChatState => ({
  lastAskedAt: view.conversation ? Date.parse(view.conversation.lastActivityAt) : null,
  turns: (view.conversation?.messages ?? []).map((m): Turn =>
    m.role === "user"
      ? { role: "user", id: m.id, text: m.text }
      : { role: "sommelier", id: m.id, answer: m.answer, rating: m.rating },
  ),
});

/** The words of a turn as the server wants them: only what was said, never what was shown. */
export const spoken = (turn: Turn, basic: (a: SommelierAnswer) => string) =>
  turn.role === "user"
    ? { role: "user" as const, text: turn.text }
    : turn.role === "sommelier"
      ? {
          role: "assistant" as const,
          // An answer may be longer than one turn of history may be (900 against 800 characters): sent whole, it
          // made every later question fail validation for as long as it stayed in the window.
          text: (turn.answer.text ?? basic(turn.answer)).slice(0, CHAT_MESSAGE_MAX),
        }
      : null;

/** The person's rating of one answer, changed (null takes it back). */
export const withRating = (
  state: ChatState,
  messageId: string,
  rating: SommelierRating | null,
): ChatState => ({
  ...state,
  turns: state.turns.map((t) =>
    t.role === "sommelier" && t.id === messageId ? { ...t, rating } : t,
  ),
});

export const ratingIn = (state: ChatState | undefined, messageId: string) => {
  const turn = state?.turns.find((t) => t.role === "sommelier" && t.id === messageId);
  return turn?.role === "sommelier" ? (turn.rating ?? null) : null;
};

/** A new random id (RFC 4122 v4) for a question, also where `crypto.randomUUID` is missing (older Safari). */
export function newQuestionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
