"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  SmartMove,
  SmartMoveResult,
  SmartSpot,
  SmartSwap,
  SmartSwapResult,
} from "@cellr/domain";
import { ApiError, api } from "@/lib/api";
import { useRefreshCellar } from "../hooks";
import { readPlacementsFresh } from "../smart-cellar-hooks";

/**
 * Placing, moving and swapping bottles through the Smart Cellar API (sprint 4). Every call sends the whole spot the
 * person SAW, so the server moves a bottle only while it is still there. After a success, everything that shows a
 * bottle's place is refreshed (racks, inventory, wine pages, the Smart Cellar places and bottles): one source of
 * truth, nothing kept aside in this screen.
 */
export function useSmartMove() {
  const refresh = useRefreshCellar();
  return useMutation({
    mutationFn: ({ bottleId, move }: { bottleId: string; move: SmartMove }) =>
      api.post<SmartMoveResult>(`/smart-cellar/bottles/${bottleId}/move`, move),
    onSettled: () => refresh(),
  });
}

export function useSmartSwap() {
  const refresh = useRefreshCellar();
  return useMutation({
    mutationFn: ({ bottleId, swap }: { bottleId: string; swap: SmartSwap }) =>
      api.post<SmartSwapResult>(`/smart-cellar/bottles/${bottleId}/swap`, swap),
    onSettled: () => refresh(),
  });
}

/** Whether a failure leaves the outcome unknown (the request may or may not have reached the database). */
export const uncertain = (error: unknown): boolean =>
  error instanceof ApiError && (error.code === "NETWORK" || error.code === "INTERNAL");

/**
 * Where a bottle is NOW, read fresh from the server, looked for in the places named (the source and the target of
 * a move whose answer was lost). "unplaced" means: in none of them and the source was "no place"; "elsewhere": in
 * none of them otherwise; "unknown": the read itself failed. Never answered from the cache.
 */
export function useWhereIsBottle() {
  const queryClient = useQueryClient();
  return async (
    bottleId: string,
    places: ReadonlyArray<string | null>,
  ): Promise<{ kind: "at"; spot: SmartSpot } | { kind: "elsewhere" | "unknown" }> => {
    try {
      for (const id of new Set(places.filter((p): p is string => p !== null))) {
        const fresh = await readPlacementsFresh(queryClient, id);
        const p = fresh.placements.find((x) => x.bottleId === bottleId);
        if (p)
          return {
            kind: "at",
            spot: { locationId: p.locationId, row: p.row, col: p.col, index: p.index },
          };
      }
      return { kind: "elsewhere" };
    } catch {
      return { kind: "unknown" };
    }
  };
}
