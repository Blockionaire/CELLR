"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  AddBottles,
  AddBottlesResult,
  BottleAction,
  BottleActionResult,
  CellarView,
  CreateStorage,
  CreateWine,
  ImageRef,
  ImageSide,
  Quad,
  RackView,
  SaveTasting,
  StorageUnitView,
  TastingView,
  UpdatePurchase,
  UpdateStorage,
  VintageInsightView,
  UpdateWine,
  VintageDetail,
  WineSummary,
} from "@cellr/domain";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ERROR_MESSAGES } from "@cellr/domain";
import { track } from "@/lib/analytics";
import { tasteKey } from "@/features/taste/hooks";
import { api, errorMessage } from "@/lib/api";
import { flattenLabel } from "@/lib/label-flatten";
import { photoForm, UnreadablePhotoError, type PreparedPhoto } from "@/lib/photo";
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

/** Asks for the wine's AI profile and value once, if it has none yet. Never throws: a bonus, not part of adding. */
/** Vintages whose profile is being written right now: a batch adding the same wine twice asks only once. */
const profiling = new Set<string>();

async function profileInBackground(
  queryClient: QueryClient,
  vintageId: string,
  onWritten: () => void,
) {
  if (profiling.has(vintageId)) return;
  profiling.add(vintageId);
  // The wine page reads this to show "writing the profile…" instead of an idle button while it runs.
  const pending = ["insight-pending", vintageId];
  try {
    queryClient.setQueryData(pending, true);
    let view = await api.get<VintageInsightView>(`/cellar/${vintageId}/insight`);
    if (!view.ready) return;
    if (!view.insight) {
      view = await api.post<VintageInsightView>(`/cellar/${vintageId}/insight`);
      queryClient.setQueryData(["insight", vintageId], view);
      // the profile also sets the drinking window: refresh what shows it (wine page, cellar, home, stats)
      void queryClient.invalidateQueries({ queryKey: vintageKey(vintageId) });
      onWritten();
    }
    // Then what a bottle is worth, looked up on the web with sources (once; after that at most monthly).
    if (view.valuationsReady && !view.valuation && view.nextValuationAt === null) {
      const valued = await api
        .post<VintageInsightView>(`/cellar/${vintageId}/value`)
        .catch(() => null);
      if (valued) {
        queryClient.setQueryData(["insight", vintageId], valued);
        onWritten();
      }
    }
  } catch {
    // switched off, rate-limited or offline: the "Tell me about this wine" button is still there
  } finally {
    profiling.delete(vintageId);
    queryClient.setQueryData(pending, false);
  }
}

/** Adding bottles refreshes everything that shows counts or free space. */
export function useAddBottles() {
  const queryClient = useQueryClient();
  const router = useRouter();
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
      // Every wine gets its AI profile (style, grapes, alcohol, value…) the moment it is added, without a tap.
      // Quiet on purpose: if the AI is off or busy, the wine page still offers the button.
      void profileInBackground(queryClient, result.vintageId, () => router.refresh());
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
      queryClient.invalidateQueries({ queryKey: ["journal"] }),
      // The taste profile is worked out from these ratings (no AI): the next look at it is fresh.
      queryClient.invalidateQueries({ queryKey: tasteKey }),
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

/** Sends the straightened picture of just the label; the 3D bottle wears it. Best effort: the photo is already kept. */
export async function sendTexture(imageId: string, photo: Blob, quad: Quad): Promise<boolean> {
  try {
    const form = new FormData();
    form.set("texture", await flattenLabel(photo, quad), "texture.jpg");
    await api.upload(`/images/${imageId}/texture`, form, "PUT");
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps a label photo (from the camera or the library) and gives it to every bottle of the wine, as its front
 * or back. The front can come with the label's four corners, so the bottle in 3D wears just the label.
 */
export function useLabelPhoto(vintageId: string, side: ImageSide = "front") {
  const refresh = useRefreshCellar();
  const toast = useToast();
  const t = useTranslations("photo");
  const te = useTranslations();
  return useMutation({
    mutationFn: async (input: { prepared: PreparedPhoto; quad?: Quad | null }) => {
      const image = await api.upload<ImageRef>("/images", photoForm(input.prepared, side));
      if (input.quad) await sendTexture(image.id, input.prepared.photo, input.quad);
      await api.put(`/cellar/${vintageId}/photo`, { imageId: image.id, side });
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

/** Re-frames the label on a photo that is already kept. */
export function useReframeLabel() {
  const refresh = useRefreshCellar();
  const toast = useToast();
  const t = useTranslations("photo");
  return useMutation({
    mutationFn: async (input: { imageId: string; photo: Blob; quad: Quad | null }) => {
      if (input.quad) {
        if (!(await sendTexture(input.imageId, input.photo, input.quad)))
          throw new Error("texture");
      } else {
        await api.delete(`/images/${input.imageId}/texture`);
      }
    },
    onSuccess: async () => {
      toast.show(t("framed"));
      await refresh();
    },
    onError: () => toast.show(t("frameFailed"), { tone: "error" }),
  });
}

export function useRemoveLabelPhoto(vintageId: string, side: ImageSide = "front") {
  const refresh = useRefreshCellar();
  const toast = useToast();
  const t = useTranslations("photo");
  const te = useTranslations();
  return useMutation({
    mutationFn: () => api.delete(`/cellar/${vintageId}/photo?side=${side}`),
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
export function useRefreshCellar() {
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

/**
 * Correct one bottle's year. Resolves as soon as the server has moved it (with its new vintage), so the screen
 * can go straight to that vintage's page; the rest of the cellar refreshes in the background.
 */
export function useSetBottleYear() {
  const refresh = useRefreshCellar();
  return useMutation({
    mutationFn: (input: { bottleId: string; year: number | null }) =>
      api.patch<BottleActionResult>(`/bottles/${input.bottleId}`, {
        action: "setYear",
        year: input.year,
      }),
    onSuccess: () => {
      void refresh();
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
