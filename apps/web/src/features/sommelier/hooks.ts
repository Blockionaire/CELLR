"use client";

import { useMutation } from "@tanstack/react-query";
import type { AskSommelier, SommelierAnswer } from "@cellr/domain";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";

/** Asks the sommelier about the cellar. Nothing is kept on the server: the screen sends the recent conversation. */
export function useAskSommelier() {
  return useMutation({
    mutationFn: (input: AskSommelier) => api.post<SommelierAnswer>("/sommelier", input),
    // One event per answer: Tonight's pairing questions are their own event, so the two are never counted twice.
    onSuccess: (answer, input) =>
      track(
        input.mode === "tonight" ? "tonight_recommendation_generated" : "sommelier_question_asked",
        { source: answer.source },
      ),
  });
}
