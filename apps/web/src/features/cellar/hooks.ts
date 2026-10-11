"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AddBottles,
  AddBottlesResult,
  CellarView,
  CreateStorage,
  CreateWine,
  StorageUnitView,
  WineSummary,
} from "@cellr/domain";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";

export const cellarKey = ["cellar"] as const;
export const winesKey = ["wines"] as const;
export const storageKey = ["storage"] as const;

export function useCellar(initialData: CellarView) {
  return useQuery({
    queryKey: cellarKey,
    queryFn: () => api.get<CellarView>("/cellar"),
    initialData,
  });
}

export const useWines = () =>
  useQuery({ queryKey: winesKey, queryFn: () => api.get<WineSummary[]>("/wines") });

export const useStorage = () =>
  useQuery({ queryKey: storageKey, queryFn: () => api.get<StorageUnitView[]>("/storage") });

export function useCreateWine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWine) => api.post<WineSummary>("/wines", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: winesKey }),
  });
}

export function useCreateStorage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStorage) => api.post<StorageUnitView>("/storage", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: storageKey }),
  });
}

/** Adding bottles refreshes everything that shows counts or free space. */
export function useAddBottles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddBottles) => api.post<AddBottlesResult>("/bottles", input),
    onSuccess: async (result) => {
      track("bottle_added", {
        count: result.bottleIds.length,
        placed: result.placed,
        vintage: result.year === null ? "nv" : "dated",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cellarKey }),
        queryClient.invalidateQueries({ queryKey: storageKey }),
        queryClient.invalidateQueries({ queryKey: winesKey }),
      ]);
    },
  });
}
