"use client";

import { useMutation } from "@tanstack/react-query";
import type { SubmitFeedback } from "@cellr/domain";
import { api } from "@/lib/api";

/** Sends beta feedback. An explicit action of the person: never tracked, never sent in the background. */
export function useSendFeedback() {
  return useMutation({
    mutationFn: (input: SubmitFeedback) => api.post<{ ok: true }>("/feedback", input),
  });
}
