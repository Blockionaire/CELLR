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
  ImageRef,
  RackView,
  SaveTasting,
  StorageUnitView,
  TastingView,
  UpdatePurchase,
  UpdateStorage,
  UpdateWine,
  VintageDetail,
  WineSummary,
} from "@cellr/domain";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ERROR_MESSAGES } from "@cellr/domain";
import { track } from "@/lib/analytics";
import { api, errorMessage } from "@/lib/api";
import { photoForm, preparePhoto, UnreadablePhotoError } from "@/lib/photo";
import { useToast } from "@/ui/toast";

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

/** One vintage's full detail, fetched on demand (the 3D view shows it in a panel; the page gets it from the server). */
export const useVintageDetail = (vintageId: string | null) =>
  useQuery({
    queryKey: vintageKey(vintageId ?? "none"),
    queryFn: () => api.get<VintageDetail>(`/cellar/${vintageId}`),
    enabled: vintageId !== null,
  });

/**
 * Star or un-star a wine. The heart changes the instant it is tapped (every list and page that shows it),
 * and goes back, with a message, if the server says no.
 */
export function useToggleFavorite() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useTranslations("favorite");
  const te = useTranslations();
  return useMutation({
    mutationFn: (input: { wineId: string; favorite: boolean }) =>
      api.put<{ wineId: string; favorite: boolean }>(`/wines/${input.wineId}/favorite`, {
        favorite: input.favorite,
      }),
    onMutate: async ({ wineId, favorite }) => {
      await queryClient.cancelQueries({ queryKey: cellarKey });
      const cellar = queryClient.getQueryData<CellarView>(cellarKey);
      const vintages = queryClient.getQueriesData<VintageDetail>({ queryKey: ["vintage"] });
      queryClient.setQueryData<CellarView>(
        cellarKey,
        (old) =>
          old && {
            ...old,
            items: old.items.map((i) => (i.wineId === wineId ? { ...i, favorite } : i)),
          },
      );
      queryClient.setQueriesData<VintageDetail>({ queryKey: ["vintage"] }, (old) =>
        old && old.wine.id === wineId ? { ...old, wine: { ...old.wine, favorite } } : old,
      );
      return { cellar, vintages };
    },
    onSuccess: (result) => toast.show(result.favorite ? t("add") : t("removed")),
    onError: (error, _input, context) => {
      toast.show(
        errorMessage(error, (k) => te(k), ERROR_MESSAGES),
        { tone: "error" },
      );
      if (!context) return;
      queryClient.setQueryData(cellarKey, context.cellar);
      for (const [key, value] of context.vintages) queryClient.setQueryData(key, value);
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: cellarKey }),
        queryClient.invalidateQueries({ queryKey: ["vintage"] }),
      ]),
  });
}

/** Saved tastings change the wine's page, the stars on cards, and Home (which the server draws). */
function useRefreshTastings() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return () => {
    router.refresh();
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: cellarKey }),
      queryClient.invalidateQueries({ queryKey: ["vintage"] }),
    ]);
  };
}

export function useSaveTasting() {
  const refresh = useRefreshTastings();
  const toast = useToast();
  const t = useTranslations("tasting");
  return useMutation({
    mutationFn: (input: { bottleId: string; tasting: Omit<SaveTasting, never> }) =>
      api.put<TastingView>(`/bottles/${input.bottleId}/tasting`, input.tasting),
    onSuccess: async () => {
      track("rating_created");
      toast.show(t("saved"));
      await refresh();
    },
  });
}

export function useDeleteTasting() {
  const refresh = useRefreshTastings();
  const toast = useToast();
  const t = useTranslations("tasting");
  return useMutation({
    mutationFn: (bottleId: string) =>
      api.delete<{ deleted: boolean }>(`/bottles/${bottleId}/tasting`),
    onSuccess: async () => {
      toast.show(t("removed"));
      await refresh();
    },
  });
}

/** Takes a photo of the label (from the camera or the library), keeps it, and gives it to every bottle of the wine. */
export function useLabelPhoto(vintageId: string) {
  const refresh = useRefreshCellar();
  const toast = useToast();
  const t = useTranslations("photo");
  const te = useTranslations();
  return useMutation({
    mutationFn: async (file: Blob) => {
      const image = await api.upload<ImageRef>("/images", photoForm(await preparePhoto(file)));
      await api.put(`/cellar/${vintageId}/photo`, { imageId: image.id });
      return image;
    },
    onSuccess: async () => {
      toast.show(t("saved"));
      await refresh();
    },
    onError: (e) =>
      toast.show(
        e instanceof UnreadablePhotoError
          ? t("unreadable")
          : errorMessage(e, (k) => te(k), ERROR_MESSAGES),
        { tone: "error" },
      ),
  });
}

export function useRemoveLabelPhoto(vintageId: string) {
  const refresh = useRefreshCellar();
  const toast = useToast();
  const t = useTranslations("photo");
  const te = useTranslations();
  return useMutation({
    mutationFn: () => api.delete(`/cellar/${vintageId}/photo`),
    onSuccess: async () => {
      toast.show(t("removed"));
      await refresh();
    },
    onError: (e) =>
      toast.show(
        errorMessage(e, (k) => te(k), ERROR_MESSAGES),
        { tone: "error" },
      ),
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
