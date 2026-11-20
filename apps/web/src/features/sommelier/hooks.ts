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
  SommelierConversationView,
  SommelierRating,
  SommelierReply,
} from "@cellr/domain";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";
import { chatStateFrom, EMPTY_CHAT, ratingIn, withRating, type ChatState } from "./turns";

/** The general chat, as the screen holds it: kept in the query cache, so it is there again after any other screen. */
export const CHAT_KEY = ["sommelier", "conversation"] as const;
const askKey = (mode: "chat" | "tonight") => ["sommelier", "ask", mode] as const;

/**
 * Asks the sommelier about the cellar. The screen sends the recent conversation; in the general chat a question
 * id goes with it, so the server keeps the question and its answer (and sends a question it has seen back as kept).
 */
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
        { source: answer.source },
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
 * What the server last confirmed as the rating of an answer, and how many requests about it are still on their
 * way. The screen shows a tap at once; when the last request for that answer is done, it shows what the server
 * holds, whichever of the taps failed. (Putting back "what was on screen before this tap" is not enough: with two
 * quick taps, the second one's "before" is the first one's unconfirmed guess.)
 */
const settledRatings = new Map<string, { confirmed: SommelierRating | null; pending: number }>();

/** The options of `useRateAnswer`, apart from React: so the order of taps and failures can be tested as it is. */
export function rateMutation(client: QueryClient, messageId: string, onFailed: () => void) {
  return {
    scope: { id: `sommelier-feedback:${messageId}` },
    meta: { refresh: false },
    mutationFn: (input: RateSommelierAnswer) =>
      api.put<{ rating: SommelierRating | null }>("/sommelier/feedback", input),
    onMutate: (input: RateSommelierAnswer) => {
      const entry = settledRatings.get(input.messageId);
      if (!entry || entry.pending === 0)
        // Nothing on its way: what is on screen is what the server holds.
        settledRatings.set(input.messageId, {
          confirmed: ratingIn(client.getQueryData<ChatState>(CHAT_KEY), input.messageId),
          pending: 1,
        });
      else entry.pending += 1;
      updateChat(client, (state) => withRating(state, input.messageId, input.rating));
    },
    onSuccess: (result: { rating: SommelierRating | null }, input: RateSommelierAnswer) => {
      const entry = settledRatings.get(input.messageId);
      if (entry) entry.confirmed = result.rating;
    },
    onError: () => onFailed(),
    onSettled: (_result: unknown, _error: unknown, input: RateSommelierAnswer) => {
      const entry = settledRatings.get(input.messageId);
      if (!entry) return;
      entry.pending -= 1;
      if (entry.pending > 0) return;
      settledRatings.delete(input.messageId);
      // The last one is done: the screen shows what the server holds.
      updateChat(client, (state) => withRating(state, input.messageId, entry.confirmed));
    },
  };
}

/**
 * Rates one answer. The screen shows the choice at once; the requests for one answer go one after the other
 * (scope), so the last tap is the one that stays; when they are done the screen shows what the server holds.
 */
export function useRateAnswer(messageId: string, onFailed: () => void) {
  const client = useQueryClient();
  return useMutation(rateMutation(client, messageId, onFailed));
}
