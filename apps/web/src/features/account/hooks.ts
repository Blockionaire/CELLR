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
import { track } from "@/lib/analytics";
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

/** Every mutation refreshes who-am-I and the household views; some also report a product event. */
function useAccountMutation<TInput, TOutput>(
  fn: (input: TInput) => Promise<TOutput>,
  onDone?: (output: TOutput) => void,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (output) => {
      onDone?.(output);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: meKey }),
        queryClient.invalidateQueries({ queryKey: ["household"] }),
      ]);
    },
  });
}

/** Saving a name for the first time is what "creating an account" means to us: the person finished signing up. */
export const useUpdateProfile = (options: { firstTime?: boolean } = {}) =>
  useAccountMutation(
    (patch: UpdateProfile) => api.patch<Me>("/me", patch),
    () => {
      if (options.firstTime) track("account_created");
    },
  );
export const useCreateHousehold = () =>
  useAccountMutation(
    (input: CreateHousehold) => api.post<HouseholdSummary>("/households", input),
    (h) => track("household_created", {}, h.id),
  );
export const useJoinHousehold = () =>
  useAccountMutation(
    (input: { code: string }) => api.post<HouseholdSummary>("/households/join", input),
    (h) => track("household_joined", {}, h.id),
  );
export const useCreateInvite = () =>
  useAccountMutation(
    (input: { householdId: string }) =>
      api.post<InviteView>(`/households/${input.householdId}/invites`),
    () => track("invite_created"),
  );
export const useRemoveMember = () =>
  useAccountMutation((input: { householdId: string; userId: string }) =>
    api.delete(`/households/${input.householdId}/members/${input.userId}`),
  );
export const useSignOut = () => useMutation({ mutationFn: () => api.post("/auth/sign-out") });
