"use client";

import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  AskSommelier,
  RateSommelierAnswer,
  SetSommelierOutcome,
  SommelierConversationView,
  SommelierOutcome,
  SommelierRating,
  SommelierReply,
} from "@cellr/domain";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";
import {
  chatStateFrom,
  EMPTY_CHAT,
  outcomeIn,
  ratingIn,
  withOutcome,
  withRating,
  type ChatState,
} from "./turns";

/** The general chat, as the screen holds it: kept in the query cache, so it is there again after any other screen. */
export const CHAT_KEY = ["sommelier", "conversation"] as const;
const askKey = (mode: "chat" | "tonight") => ["sommelier", "ask", mode] as const;

/**
 * Asks the sommelier about the cellar. The screen sends the recent conversation; in the general chat a question
 * id goes with it, so the server keeps the question and its answer (and sends a question it has seen back as kept).
 */
import { answerMetrics } from "./plan-metrics";

export function useAskSommelier(mode: "chat" | "tonight") {
  return useMutation({
    mutationKey: askKey(mode),
    mutationFn: (input: AskSommelier) => api.post<SommelierReply>("/sommelier", input),
    // The general chat keeps its own words: an answer changes nothing the server renders, so nothing is refreshed
    // (the page would only read the conversation again). Tonight stays as it was.
    ...(mode === "chat" ? { meta: { refresh: false } } : {}),
    // One event per answer: Tonight's pairing questions are their own event, so the two are never counted twice.
    onSuccess: (answer, input) =>
      track(
        input.mode === "tonight" ? "tonight_recommendation_generated" : "sommelier_question_asked",
        answerMetrics(answer),
      ),
  });
}

/** A question to the general chat is on its way: also when it was asked before the screen was left and came back. */
export const useChatAsking = () => useIsMutating({ mutationKey: askKey("chat") }) > 0;

/**
 * The general chat. Read from the server once (the page brings it along, so there is no wait), then the cache is
 * what the screen shows: never fetched again behind its back, so nothing on screen is replaced or doubled. Only a
 * failed first read is tried again, the next time the screen opens.
 */
export function useChat(enabled: boolean, initial: SommelierConversationView | undefined) {
  return useQuery({
    queryKey: CHAT_KEY,
    enabled,
    queryFn: async () =>
      chatStateFrom(await api.get<SommelierConversationView>("/sommelier/conversation")),
    ...(initial ? { initialData: chatStateFrom(initial) } : {}),
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: (query) => query.state.status === "error",
  });
}

/** Changes the chat as the screen holds it (also after the screen was left: the cache outlives it). */
export const updateChat = (client: QueryClient, update: (state: ChatState) => ChatState) =>
  client.setQueryData<ChatState>(CHAT_KEY, (state) => update(state ?? EMPTY_CHAT));

/** "New conversation": the kept one is deleted on the server first; only then is the screen cleared. */
export function useNewConversation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete("/sommelier/conversation"),
    meta: { refresh: false },
    onSuccess: () => updateChat(client, () => EMPTY_CHAT),
  });
}

/**
 * Rates one answer. The screen shows the choice at once; the requests for one answer go one after the other
 * (scope), so the last tap is the one that stays. A failure puts the earlier rating back.
 */
export function useRateAnswer(messageId: string, onFailed: () => void) {
  const client = useQueryClient();
  return useMutation({
    scope: { id: `sommelier-feedback:${messageId}` },
    meta: { refresh: false },
    mutationFn: (input: RateSommelierAnswer) =>
      api.put<{ rating: SommelierRating | null }>("/sommelier/feedback", input),
    onMutate: (input) => {
      const before = ratingIn(client.getQueryData<ChatState>(CHAT_KEY), input.messageId);
      updateChat(client, (state) => withRating(state, input.messageId, input.rating));
      return { before };
    },
    onError: (_error, input, context) => {
      updateChat(client, (state) => withRating(state, input.messageId, context?.before ?? null));
      onFailed();
    },
  });
}

/**
 * Says what came of one bottle of one answer (or takes it back). Shown at once; the requests for one bottle go one
 * after the other, so the last tap is what stays. A failure puts back what was said before. Its own event, with
 * the three signals as they now stand and nothing about the wine, the dish or the answer's words.
 */
export function useSetOutcome(messageId: string, onFailed: () => void) {
  const client = useQueryClient();
  return useMutation({
    scope: { id: `sommelier-outcome:${messageId}` },
    meta: { refresh: false },
    mutationFn: (input: SetSommelierOutcome) =>
      api.put<{ outcome: SommelierOutcome | null }>("/sommelier/outcomes", input),
    onMutate: (input) => {
      const before = outcomeIn(
        client.getQueryData<ChatState>(CHAT_KEY),
        input.messageId,
        input.vintageId,
      );
      updateChat(client, (state) =>
        withOutcome(
          state,
          input.messageId,
          input.vintageId,
          input.opened
            ? { vintageId: input.vintageId, withDish: input.withDish, enjoyed: input.enjoyed }
            : null,
        ),
      );
      return { before };
    },
    onSuccess: (_result, input) =>
      track("sommelier_outcome_said", {
        opened: input.opened,
        with_dish: input.withDish === null ? "not-said" : input.withDish ? "yes" : "no",
        enjoyed: input.enjoyed ?? "not-said",
      }),
    onError: (_error, input, context) => {
      updateChat(client, (state) =>
        withOutcome(state, input.messageId, input.vintageId, context?.before ?? null),
      );
      onFailed();
    },
  });
}
