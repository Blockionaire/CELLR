"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateHousehold,
  HouseholdDetail,
  HouseholdSummary,
  InviteView,
  Me,
  UpdateProfile,
} from "@cellr/domain";
import { api } from "@/lib/api";

export const meKey = ["me"] as const;
export const householdKey = (id: string) => ["household", id] as const;

export function useMe(initialData?: Me) {
  return useQuery({
    queryKey: meKey,
    queryFn: () => api.get<Me>("/me"),
    ...(initialData ? { initialData } : {}),
  });
}

export function useHousehold(id: string | null) {
  return useQuery({
    queryKey: householdKey(id ?? "none"),
    queryFn: () => api.get<HouseholdDetail>(`/households/${id}`),
    enabled: id !== null,
  });
}

/** Every mutation refreshes who-am-I and the household views. */
function useAccountMutation<TInput, TOutput>(fn: (input: TInput) => Promise<TOutput>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: meKey }),
        queryClient.invalidateQueries({ queryKey: ["household"] }),
      ]);
    },
  });
}

export const useUpdateProfile = () =>
  useAccountMutation((patch: UpdateProfile) => api.patch<Me>("/me", patch));
export const useCreateHousehold = () =>
  useAccountMutation((input: CreateHousehold) => api.post<HouseholdSummary>("/households", input));
export const useJoinHousehold = () =>
  useAccountMutation((input: { code: string }) =>
    api.post<HouseholdSummary>("/households/join", input),
  );
export const useCreateInvite = () =>
  useAccountMutation((input: { householdId: string }) =>
    api.post<InviteView>(`/households/${input.householdId}/invites`),
  );
export const useRemoveMember = () =>
  useAccountMutation((input: { householdId: string; userId: string }) =>
    api.delete(`/households/${input.householdId}/members/${input.userId}`),
  );
export const useSignOut = () => useMutation({ mutationFn: () => api.post("/auth/sign-out") });
