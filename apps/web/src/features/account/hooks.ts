"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateHousehold,
  HouseholdDetail,
  HouseholdSummary,
  InviteView,
  Me,
  UpdateHousehold,
  UpdateProfile,
} from "@cellr/domain";
import { track } from "@/lib/analytics";
import type { ErrorCode } from "@cellr/domain";
import { api, ApiError } from "@/lib/api";

export const meKey = ["me"] as const;
export const householdKey = (id: string) => ["household", id] as const;

/** My CELLR points (earned by sharing bottle photos). */
export const usePoints = () =>
  useQuery({ queryKey: ["points"], queryFn: () => api.get<{ total: number }>("/me/points") });

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

/** A new profile photo (a small square JPEG made on this device), then who I am now. */
export const useSetAvatar = () =>
  useAccountMutation((photo: Blob) => {
    const form = new FormData();
    form.set("photo", photo, "avatar.jpg");
    return api.upload<Me>("/me/avatar", form, "PUT");
  });

/** Back to the initials. */
export const useRemoveAvatar = () => useAccountMutation(() => api.delete<Me>("/me/avatar"));

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
/** Makes another household the one every screen shows. The caller reloads: nothing cached may outlive the switch. */
export const useSetActiveHousehold = () =>
  useMutation({
    mutationFn: (householdId: string) => api.put<Me>("/households/active", { householdId }),
  });
export const useSignOut = () => useMutation({ mutationFn: () => api.post("/auth/sign-out") });

export const useUpdateHousehold = () =>
  useAccountMutation((input: { id: string; patch: UpdateHousehold }) =>
    api.patch<HouseholdSummary>(`/households/${input.id}`, input.patch),
  );
export const useDeleteHousehold = () =>
  useAccountMutation((id: string) => api.delete(`/households/${id}`));

/**
 * Downloads everything the household keeps as one file. It is fetched, not linked to, so a failure can say so
 * instead of showing the browser an error page.
 */
export function useExportData() {
  return useMutation({
    mutationFn: async () => {
      let response: Response;
      try {
        response = await fetch("/api/v1/export", { credentials: "same-origin" });
      } catch {
        throw new ApiError("NETWORK", "", true);
      }
      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as {
          error?: { code?: ErrorCode; message?: string; retryable?: boolean };
        } | null;
        throw new ApiError(json?.error?.code ?? "INTERNAL", json?.error?.message ?? "", false);
      }
      const name =
        /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ??
        "cellr.json";
      const url = URL.createObjectURL(await response.blob());
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.append(link);
        link.click();
        link.remove();
      } finally {
        // The browser has what it needs once the click has been handled.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
      return name;
    },
  });
}

/** Deletes the signed-in person's account (they type their email to confirm). */
export const useDeleteAccount = () =>
  useMutation({
    mutationFn: (email: string) =>
      // `api.delete` sends no body; this one needs the email.
      fetch("/api/v1/me", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      }).then(async (response) => {
        if (response.ok) return;
        const json = (await response.json().catch(() => null)) as {
          error?: { code?: ErrorCode; message?: string };
        } | null;
        throw new ApiError(json?.error?.code ?? "INTERNAL", json?.error?.message ?? "", false);
      }),
  });
