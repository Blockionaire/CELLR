"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  ERROR_MESSAGES,
  type FoundPerson,
  type FriendView,
  type FriendsView,
  type Recommend,
  type RecommendationsView,
  type SaveSharing,
  type SharingView,
} from "@cellr/domain";
import { api, errorMessage } from "@/lib/api";
import { useToast } from "@/ui/toast";

export const friendsKey = ["friends"] as const;
export const sharingKey = ["sharing"] as const;
export const friendKey = (userId: string) => ["friends", userId] as const;
export const recommendationsKey = ["recommendations"] as const;

export function useFriends(initialData?: FriendsView) {
  return useQuery({
    queryKey: friendsKey,
    queryFn: () => api.get<FriendsView>("/friends"),
    ...(initialData ? { initialData } : {}),
  });
}

export function useFriend(userId: string, initialData: FriendView) {
  return useQuery({
    queryKey: friendKey(userId),
    queryFn: () => api.get<FriendView>(`/friends/${userId}`),
    initialData,
  });
}

export function useSharing(initialData: SharingView | null) {
  return useQuery({
    queryKey: sharingKey,
    queryFn: () => api.get<SharingView>("/sharing"),
    ...(initialData ? { initialData } : {}),
  });
}

/** Mutations here all say what went wrong the same way, and refresh the friends list after. */
function useFriendsMutation<I, O>(fn: (input: I) => Promise<O>, done?: (out: O, input: I) => void) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const te = useTranslations();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (out, input) => {
      done?.(out, input);
      await queryClient.invalidateQueries({ queryKey: friendsKey });
    },
    onError: (e) =>
      toast.show(
        errorMessage(e, (k) => te(k), ERROR_MESSAGES),
        { tone: "error" },
      ),
  });
}

export function useSetHandle() {
  const toast = useToast();
  const t = useTranslations("friends");
  return useFriendsMutation(
    (handle: string) => api.put<{ handle: string }>("/me/handle", { handle }),
    () => toast.show(t("handleSaved")),
  );
}

export function useFindPerson() {
  return useMutation({
    mutationFn: (q: string) =>
      api.get<{ person: FoundPerson | null }>(`/friends/search?q=${encodeURIComponent(q)}`),
  });
}

export function useSendRequest() {
  const toast = useToast();
  const t = useTranslations("friends");
  return useFriendsMutation(
    (userId: string) =>
      api.post<{ result: "sent" | "accepted" | "already" }>("/friends", { userId }),
    (out) => toast.show(out.result === "accepted" ? t("nowFriends") : t("requestSent")),
  );
}

export function useRespond() {
  const toast = useToast();
  const t = useTranslations("friends");
  return useFriendsMutation(
    (input: { friendshipId: string; accept: boolean }) =>
      api.post(`/friends/requests/${input.friendshipId}`, { accept: input.accept }),
    (_, input) => toast.show(input.accept ? t("nowFriends") : t("declined")),
  );
}

export function useRemoveFriend() {
  const queryClient = useQueryClient();
  return useFriendsMutation(
    (userId: string) => api.delete(`/friends/${userId}`),
    () => void queryClient.invalidateQueries({ queryKey: sharingKey }),
  );
}

export function useSaveSharing() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const tc = useTranslations("common");
  const te = useTranslations();
  return useMutation({
    mutationFn: (input: SaveSharing) => api.put<SharingView>("/sharing", input),
    onSuccess: (view) => {
      queryClient.setQueryData(sharingKey, view);
      toast.show(tc("saved"));
    },
    onError: (e) =>
      toast.show(
        errorMessage(e, (k) => te(k), ERROR_MESSAGES),
        { tone: "error" },
      ),
  });
}

export function useRecommendations(initialData?: RecommendationsView) {
  return useQuery({
    queryKey: recommendationsKey,
    queryFn: () => api.get<RecommendationsView>("/recommendations"),
    ...(initialData ? { initialData } : {}),
  });
}

export function useRecommend() {
  const toast = useToast();
  const t = useTranslations("friends");
  const te = useTranslations();
  return useMutation({
    mutationFn: (input: Recommend) => api.post<{ sent: number }>("/recommendations", input),
    onSuccess: ({ sent }) => toast.show(t("recommended", { count: sent })),
    onError: (e) =>
      toast.show(
        errorMessage(e, (k) => te(k), ERROR_MESSAGES),
        { tone: "error" },
      ),
  });
}

/** Save to my wishlist, dismiss, or mark all seen: each refreshes the list (and the wishlist when saving). */
export function useRecommendationAction() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useTranslations("friends");
  const te = useTranslations();
  return useMutation({
    mutationFn: (input: { id: string; action: "save" | "dismiss" } | { action: "seen" }) =>
      input.action === "seen"
        ? api.post("/recommendations/seen", {})
        : input.action === "save"
          ? api.post(`/recommendations/${input.id}/save`, {})
          : api.delete(`/recommendations/${input.id}`),
    onSuccess: async (_, input) => {
      if (input.action === "save") toast.show(t("savedToWishlist"));
      if (input.action === "save") await queryClient.invalidateQueries({ queryKey: ["wishlist"] });
      await queryClient.invalidateQueries({ queryKey: recommendationsKey });
    },
    onError: (e) =>
      toast.show(
        errorMessage(e, (k) => te(k), ERROR_MESSAGES),
        { tone: "error" },
      ),
  });
}
