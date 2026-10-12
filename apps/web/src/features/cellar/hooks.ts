"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AddBottles,
  AddBottlesResult,
  BottleAction,
  BottleActionResult,
  CellarView,
  CreateStorage,
  CreateWine,
  RackView,
  StorageUnitView,
  UpdatePurchase,
  UpdateStorage,
  UpdateWine,
  VintageDetail,
  WineSummary,
} from "@cellr/domain";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";

export const cellarKey = ["cellar"] as const;
export const winesKey = ["wines"] as const;
export const storageKey = ["storage"] as const;
export const racksKey = ["racks"] as const;
export const vintageKey = (id: string) => ["vintage", id] as const;

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
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: storageKey }),
        queryClient.invalidateQueries({ queryKey: racksKey }),
      ]),
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
        queryClient.invalidateQueries({ queryKey: racksKey }),
        queryClient.invalidateQueries({ queryKey: ["vintage"] }),
      ]);
    },
  });
}

export function useVintage(vintageId: string, initialData: VintageDetail) {
  return useQuery({
    queryKey: vintageKey(vintageId),
    queryFn: () => api.get<VintageDetail>(`/cellar/${vintageId}`),
    initialData,
  });
}

export const useRacks = () =>
  useQuery({ queryKey: racksKey, queryFn: () => api.get<RackView>("/racks") });

/** Anything that changes bottles must refresh every place that shows counts, spots or free space. */
function useRefreshCellar() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: cellarKey }),
      queryClient.invalidateQueries({ queryKey: ["vintage"] }),
      queryClient.invalidateQueries({ queryKey: racksKey }),
      queryClient.invalidateQueries({ queryKey: storageKey }),
    ]);
}

/** Open, move, restore or remove one bottle. Resolves after fresh data is in, so screens never flash stale counts. */
export function useBottleAction() {
  const refresh = useRefreshCellar();
  return useMutation({
    mutationFn: (input: { bottleId: string; action: BottleAction }) =>
      api.patch<BottleActionResult>(`/bottles/${input.bottleId}`, input.action),
    onSuccess: async (_result, input) => {
      if (input.action.action === "open") track("bottle_opened");
      await refresh();
    },
  });
}

export function useUpdateWine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { wineId: string; patch: UpdateWine }) =>
      api.patch<WineSummary>(`/wines/${input.wineId}`, input.patch),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: cellarKey }),
        queryClient.invalidateQueries({ queryKey: ["vintage"] }),
        queryClient.invalidateQueries({ queryKey: winesKey }),
        queryClient.invalidateQueries({ queryKey: racksKey }),
      ]),
  });
}

export function useUpdatePurchase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { vintageId: string; patch: UpdatePurchase }) =>
      api.patch<{ updated: number }>(`/cellar/${input.vintageId}/purchase`, input.patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vintage"] }),
  });
}

/** Renaming or resizing a place changes what cards and racks show, so everything is refreshed. */
export function useUpdateStorage() {
  const refresh = useRefreshCellar();
  return useMutation({
    mutationFn: (input: { id: string; patch: UpdateStorage }) =>
      api.patch<StorageUnitView>(`/storage/${input.id}`, input.patch),
    onSuccess: () => refresh(),
  });
}

export function useDeleteStorage() {
  const refresh = useRefreshCellar();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/storage/${id}`),
    onSuccess: () => refresh(),
  });
}
