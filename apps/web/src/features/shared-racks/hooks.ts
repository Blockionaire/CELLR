"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  FoundPerson,
  MySharedRackBottleView,
  MySharedRackInvitationView,
  SharedRackBottlesView,
  SharedRackCreate,
  SharedRackEventsView,
  SharedRackInvitationView,
  SharedRackLayout,
  SharedRackMemberView,
  SharedRackMoveResult,
  SharedRackPlaceResult,
  SharedRackRole,
  SharedRackSpot,
  SharedRackView,
} from "@cellr/domain";
import { api } from "@/lib/api";
import { useRefreshCellar } from "@/features/cellar/hooks";

/**
 * Shared racks through the existing API client and query cache (ADR-010; the contracts are in
 * docs/sprints/smart-cellar-3d/SHARED-RACKS-REPORT.md §3). Nothing here is asked for unless a screen of this folder is
 * mounted, and those are mounted only where the server said shared racks are open: with the gate closed none of these
 * queries exists.
 *
 * One source of truth: after every change (and every refusal) what the server holds is read again; nothing is kept
 * aside in a screen, and a refused change is never tried again somewhere else.
 */
export const sharedRacksKey = ["shared-racks"] as const;
export const sharedRackListKey = [...sharedRacksKey, "list"] as const;
export const myInvitationsKey = [...sharedRacksKey, "my-invitations"] as const;
export const mySharedBottlesKey = [...sharedRacksKey, "my-bottles"] as const;
export const sharedRackKey = (rackId: string) => [...sharedRacksKey, "rack", rackId] as const;
export const sharedRackBottlesKey = (rackId: string) =>
  [...sharedRackKey(rackId), "bottles"] as const;
export const sharedRackMembersKey = (rackId: string) =>
  [...sharedRackKey(rackId), "members"] as const;
export const sharedRackInvitationsKey = (rackId: string) =>
  [...sharedRackKey(rackId), "invitations"] as const;
export const sharedRackEventsKey = (rackId: string, filter: EventFilter) =>
  [...sharedRackKey(rackId), "events", filter] as const;

export interface SharedRackList {
  version: number;
  writes: boolean;
  depthPlacement: boolean;
  racks: SharedRackView[];
}

/** My racks (not the archived ones), and whether this server writes. */
export const useSharedRacks = (enabled = true) =>
  useQuery({
    queryKey: sharedRackListKey,
    queryFn: () => api.get<SharedRackList>("/shared-racks"),
    enabled,
  });

/** My archived racks too: asked for only where they are listed. */
export const useAllSharedRacks = (enabled: boolean) =>
  useQuery({
    queryKey: [...sharedRackListKey, "archived"] as const,
    queryFn: () => api.get<SharedRackList>("/shared-racks?archived=1"),
    enabled,
  });

/** Invitations waiting for me. */
export const useMyInvitations = (enabled = true) =>
  useQuery({
    queryKey: myInvitationsKey,
    queryFn: () =>
      api.get<{ invitations: MySharedRackInvitationView[] }>("/shared-racks/invitations"),
    enabled,
  });

/** The bottles of my own cellar that stand in a shared rack. */
export const useMySharedBottles = (enabled = true) =>
  useQuery({
    queryKey: mySharedBottlesKey,
    queryFn: () => api.get<{ bottles: MySharedRackBottleView[] }>("/shared-racks/bottles"),
    enabled,
  });

/**
 * One rack and every bottle in it. Checked again whenever it is come back to: someone else may have moved a bottle.
 * A failure is not retried by itself: "not found" here means I am no longer a member, and that is said at once.
 */
export const useSharedRackBottles = (rackId: string | null) =>
  useQuery({
    queryKey: sharedRackBottlesKey(rackId ?? "none"),
    queryFn: () => api.get<SharedRackBottlesView>(`/shared-racks/${rackId}/bottles`),
    enabled: rackId !== null,
    staleTime: 0,
    retry: false,
  });

export const useSharedRackMembers = (rackId: string | null, enabled = true) =>
  useQuery({
    queryKey: sharedRackMembersKey(rackId ?? "none"),
    queryFn: () => api.get<{ members: SharedRackMemberView[] }>(`/shared-racks/${rackId}/members`),
    enabled: rackId !== null && enabled,
    retry: false,
  });

/** The rack's invitations: owners only (the server refuses anyone else, so it is asked only for an owner). */
export const useSharedRackInvitations = (rackId: string, enabled: boolean) =>
  useQuery({
    queryKey: sharedRackInvitationsKey(rackId),
    queryFn: () =>
      api.get<{ invitations: SharedRackInvitationView[] }>(`/shared-racks/${rackId}/invitations`),
    enabled,
    retry: false,
  });

export interface EventFilter {
  owner?: string | undefined;
  actor?: string | undefined;
  /** One bottle, followed through the rack by a placement of it. */
  placement?: string | undefined;
}

export const eventsPath = (
  rackId: string,
  filter: EventFilter,
  before: number | null,
  limit = 30,
) => {
  const query = new URLSearchParams({ limit: String(limit) });
  if (before !== null) query.set("before", String(before));
  if (filter.owner) query.set("owner", filter.owner);
  if (filter.actor) query.set("actor", filter.actor);
  if (filter.placement) query.set("placement", filter.placement);
  return `/shared-racks/${rackId}/events?${query.toString()}`;
};

/** The rack's history, newest first, a page at a time ("load older"). */
export const useSharedRackEvents = (rackId: string, filter: EventFilter, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: sharedRackEventsKey(rackId, filter),
    queryFn: ({ pageParam }) =>
      api.get<SharedRackEventsView>(eventsPath(rackId, filter, pageParam)),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore,
    enabled,
    retry: false,
  });

/**
 * A rack I may no longer see (removed, left, gone): everything of it leaves the cache NOW, not when the cache would
 * have let it go by itself, so nothing of other people's bottles stays in this tab's memory. The list of my racks is
 * read again (it still names the rack). Called only once no screen asks for the rack any more: a query that is still
 * asked for would simply be fetched again.
 */
export function forgetSharedRack(queryClient: QueryClient, rackId: string) {
  queryClient.removeQueries({ queryKey: sharedRackKey(rackId) });
  return queryClient.invalidateQueries({ queryKey: sharedRackListKey });
}

/** Everything about shared racks is read again (after a change, and after a refusal). */
export const refreshSharedRacks = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ queryKey: sharedRacksKey });

/**
 * A change to shared racks. Whatever it answers, what the server holds is read again. `cellar`: the change also
 * touches my own cellar (a bottle left its private place, or came back to it without one).
 */
function useSharedRackMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  options: { cellar?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const refreshCellar = useRefreshCellar();
  return useMutation({
    mutationFn,
    onSettled: () =>
      Promise.all([refreshSharedRacks(queryClient), ...(options.cellar ? [refreshCellar()] : [])]),
  });
}

export const useCreateSharedRack = () =>
  useSharedRackMutation((input: SharedRackCreate) =>
    api.post<SharedRackView>("/shared-racks", input),
  );

export const useRenameSharedRack = (rackId: string) =>
  useSharedRackMutation((name: string) =>
    api.patch<SharedRackView>(`/shared-racks/${rackId}`, { name }),
  );

/** The whole layout, saved against the version it started from: of two saves from one version, one is refused. */
export const useSaveSharedRackLayout = (rackId: string) =>
  useSharedRackMutation(({ layout, revision }: { layout: SharedRackLayout; revision: string }) =>
    api.put<SharedRackView>(`/shared-racks/${rackId}/layout`, layout, { ifMatch: revision }),
  );

export const useArchiveSharedRack = (rackId: string) =>
  useSharedRackMutation((archived: boolean) =>
    archived
      ? api.delete<SharedRackView>(`/shared-racks/${rackId}`)
      : api.post<SharedRackView>(`/shared-racks/${rackId}/restore`),
  );

/** The existing exact search for a person (an account name or a friend code). Being friends is not needed. */
export const useFindPerson = () =>
  useMutation({
    mutationFn: (q: string) =>
      api.get<{ person: FoundPerson | null }>(`/friends/search?q=${encodeURIComponent(q)}`),
  });

export const useInvite = (rackId: string) =>
  useSharedRackMutation((userId: string) =>
    api.post<{ invitationId: string; outcome: "invited" | "already_invited" }>(
      `/shared-racks/${rackId}/invitations`,
      { userId },
    ),
  );

export const useCancelInvitation = () =>
  useSharedRackMutation((invitationId: string) =>
    api.delete(`/shared-racks/invitations/${invitationId}`),
  );

export const useRespondInvitation = () =>
  useSharedRackMutation(({ invitationId, accept }: { invitationId: string; accept: boolean }) =>
    api.post<{ outcome: "accepted" | "declined"; rackId: string | null }>(
      `/shared-racks/invitations/${invitationId}`,
      { accept },
    ),
  );

export const useSetMemberRole = (rackId: string) =>
  useSharedRackMutation(({ userId, role }: { userId: string; role: SharedRackRole }) =>
    api.patch<{ userId: string; role: SharedRackRole }>(
      `/shared-racks/${rackId}/members/${userId}`,
      { role },
    ),
  );

export const useRemoveMember = (rackId: string) =>
  useSharedRackMutation((userId: string) =>
    api.delete(`/shared-racks/${rackId}/members/${userId}`),
  );

export const useLeaveSharedRack = (rackId: string) =>
  useSharedRackMutation(() => api.post<void>(`/shared-racks/${rackId}/leave`));

/** One of MY bottles onto a spot. Nothing in the request says whose it is: it is mine because I place it. */
export const usePlaceBottle = (rackId: string) =>
  useSharedRackMutation(
    ({ bottleId, to }: { bottleId: string; to: SharedRackSpot }) =>
      api.post<SharedRackPlaceResult>(`/shared-racks/${rackId}/bottles`, { bottleId, to }),
    { cellar: true },
  );

/** Any bottle, from the spot I SAW it on to a free one. */
export const useMoveBottle = (rackId: string) =>
  useSharedRackMutation(
    ({
      placementId,
      from,
      to,
    }: {
      placementId: string;
      from: SharedRackSpot;
      to: SharedRackSpot;
    }) =>
      api.post<SharedRackMoveResult>(`/shared-racks/${rackId}/bottles/${placementId}/move`, {
        from,
        to,
      }),
  );

/** "I took this bottle out", from the spot I SAW it on. It is not consumed: its owner's record is not touched. */
export const useTakeOutBottle = (rackId: string) =>
  useSharedRackMutation(
    ({ placementId, from }: { placementId: string; from: SharedRackSpot }) =>
      api.post<{ placementId: string; outcome: "taken_out" }>(
        `/shared-racks/${rackId}/bottles/${placementId}/take-out`,
        { from },
      ),
    { cellar: true },
  );

/** My own bottle is no longer in that rack (with or without access to the rack). */
export const useWithdrawBottle = () =>
  useSharedRackMutation((bottleId: string) => api.delete(`/shared-racks/bottles/${bottleId}`), {
    cellar: true,
  });
