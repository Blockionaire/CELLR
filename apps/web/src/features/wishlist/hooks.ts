"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  ERROR_MESSAGES,
  type AddWish,
  type UpdateWish,
  type WishlistItem,
  type WishlistView,
} from "@cellr/domain";
import { api, errorMessage } from "@/lib/api";
import { useToast } from "@/ui/toast";

export const wishlistKey = ["wishlist"] as const;

export function useWishlist(initialData: WishlistView) {
  return useQuery({
    queryKey: wishlistKey,
    queryFn: () => api.get<WishlistView>("/wishlist"),
    initialData,
  });
}

/** Puts a wine on the wishlist. Says so itself, so every screen that adds one answers the same way. */
export function useAddWish() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useTranslations("wishlist");
  const te = useTranslations();
  return useMutation({
    mutationFn: (input: AddWish) => api.post<WishlistItem>("/wishlist", input),
    onSuccess: async () => {
      toast.show(t("added"));
      await queryClient.invalidateQueries({ queryKey: wishlistKey });
    },
    onError: (e) =>
      toast.show(
        errorMessage(e, (k) => te(k), ERROR_MESSAGES),
        { tone: "error" },
      ),
  });
}

export function useUpdateWish() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useTranslations("wishlist");
  return useMutation({
    mutationFn: (input: { id: string; patch: UpdateWish }) =>
      api.patch<WishlistItem>(`/wishlist/${input.id}`, input.patch),
    onSuccess: async () => {
      toast.show(t("updated"));
      await queryClient.invalidateQueries({ queryKey: wishlistKey });
    },
  });
}

/**
 * Takes a wish off the list. Removing one is easy to do by accident, so the message offers Undo, which puts
 * it back as it was.
 */
export function useRemoveWish() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useTranslations("wishlist");
  const te = useTranslations();
  return useMutation({
    mutationFn: (item: WishlistItem) => api.delete(`/wishlist/${item.id}`),
    onSuccess: async (_, item) => {
      await queryClient.invalidateQueries({ queryKey: wishlistKey });
      toast.show(t("removed"), {
        action: {
          label: t("undo"),
          onClick: () => {
            void api
              .post("/wishlist", {
                wineId: item.wineId,
                year: item.year,
                note: item.note,
                maxPriceCents: item.maxPriceCents,
              })
              .then(() => queryClient.invalidateQueries({ queryKey: wishlistKey }));
          },
        },
      });
    },
    onError: (e) =>
      toast.show(
        errorMessage(e, (k) => te(k), ERROR_MESSAGES),
        { tone: "error" },
      ),
  });
}

/** The wish was fulfilled (the wine was bought): take it off the list and say so, with nothing to undo. */
export function useForgetWish() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useTranslations("wishlist");
  return useMutation({
    mutationFn: (wishId: string) => api.delete(`/wishlist/${wishId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: wishlistKey });
      toast.show(t("boughtRemoved"));
    },
  });
}
