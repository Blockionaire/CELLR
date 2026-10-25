"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SaveTastePreferences, TasteProfileView } from "@cellr/domain";
import { api } from "@/lib/api";

export const tasteKey = ["taste-profile"] as const;

export function useTasteProfile(initialData: TasteProfileView) {
  return useQuery({
    queryKey: tasteKey,
    queryFn: () => api.get<TasteProfileView>("/taste-profile"),
    initialData,
    refetchOnMount: "always",
  });
}

/** Saves my own answers; the profile that comes back replaces the one on screen. */
export function useSaveTaste() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveTastePreferences) =>
      api.put<TasteProfileView>("/taste-profile/preferences", input),
    onSuccess: (view) => queryClient.setQueryData(tasteKey, view),
  });
}
