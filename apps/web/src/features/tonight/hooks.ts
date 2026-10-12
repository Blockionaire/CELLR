"use client";

import { useMutation } from "@tanstack/react-query";
import type { TonightRequest, TonightView } from "@cellr/domain";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";

/** Asks for tonight's picks. Nothing is stored: each ask is a fresh look at the cellar as it is now. */
export function useTonight() {
  return useMutation({
    mutationFn: (input: TonightRequest) => api.post<TonightView>("/tonight", input),
    onSuccess: () => track("tonight_recommendation_generated"),
  });
}
