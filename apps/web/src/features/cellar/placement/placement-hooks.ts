"use client";

import { useMutation } from "@tanstack/react-query";
import type {
  SmartBottleSpot,
  SmartMove,
  SmartMoveResult,
  SmartSwap,
  SmartSwapResult,
} from "@cellr/domain";
import { ApiError, api } from "@/lib/api";
import { useRefreshCellar } from "../hooks";
import type { BottleRead } from "./reconcile";

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
 * Where ONE bottle is now, read from the database (GET /smart-cellar/bottles/:id: as the person, row-level security,
 * every API answer `no-store`). Deliberately NOT a query: nothing is kept, so a cached answer can never stand in as
 * proof that a bottle moved. A failed read is `{ ok: false }`, and the caller says the outcome is unknown.
 */
export async function readBottleNow(bottleId: string): Promise<BottleRead> {
  try {
    return {
      ok: true,
      bottle: await api.get<SmartBottleSpot>(`/smart-cellar/bottles/${bottleId}`),
    };
  } catch {
    return { ok: false };
  }
}
