"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BottleExtras,
  BottleExtrasView,
  RemindersView,
  VintageInsightView,
} from "@cellr/domain";
import { api } from "@/lib/api";

export const insightKey = (vintageId: string) => ["insight", vintageId] as const;
export const extrasKey = (vintageId: string) => ["extras", vintageId] as const;
export const remindersKey = ["reminders"] as const;

export const useInsight = (vintageId: string) =>
  useQuery({
    queryKey: insightKey(vintageId),
    queryFn: () => api.get<VintageInsightView>(`/cellar/${vintageId}/insight`),
  });

/** Asks the AI for a profile of the wine; the answer replaces what was shown. */
export function useGenerateInsight(vintageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<VintageInsightView>(`/cellar/${vintageId}/insight`),
    onSuccess: (view) => queryClient.setQueryData(insightKey(vintageId), view),
  });
}

export function useSaveMyValue(vintageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (myValueCents: number | null) =>
      api.put<VintageInsightView>(`/cellar/${vintageId}/insight`, { myValueCents }),
    onSuccess: (view) => queryClient.setQueryData(insightKey(vintageId), view),
  });
}

export const useExtras = (vintageId: string) =>
  useQuery({
    queryKey: extrasKey(vintageId),
    queryFn: () =>
      api.get<{ ready: boolean; items: BottleExtrasView[] }>(`/cellar/${vintageId}/extras`),
  });

export function useSaveExtras(vintageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { bottleId: string; extras: BottleExtras }) =>
      api.put<BottleExtrasView>(`/bottles/${input.bottleId}/extras`, input.extras),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: extrasKey(vintageId) }),
        queryClient.invalidateQueries({ queryKey: remindersKey }),
      ]),
  });
}

export const useReminders = () =>
  useQuery({ queryKey: remindersKey, queryFn: () => api.get<RemindersView>("/reminders") });
