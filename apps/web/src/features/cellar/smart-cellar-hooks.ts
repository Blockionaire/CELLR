"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  SmartCellarCapabilities,
  SmartStoragePlacementsView,
  SmartStorageUnitView,
} from "@cellr/domain";
import { api } from "@/lib/api";

/**
 * The cellar's places and bottles in the Smart Cellar's terms (sprint 2B.3), read through the existing API client
 * and query cache. Only the 3D view asks, and only where the server said the new renderer may be used: with the
 * gate closed none of these queries exists, so nothing is requested and invalidating them is a no-op.
 *
 * Everything under `smartStorageKey` is refreshed wherever the racks are (features/cellar/hooks.ts): a bottle
 * added, moved, opened or removed, a place made, changed or deleted, a label photo changed.
 */
export const smartCellarKey = ["smart-cellar"] as const;
export const smartCapabilitiesKey = [...smartCellarKey, "capabilities"] as const;
/** Places and their bottles: what changes when the cellar does. */
export const smartStorageKey = [...smartCellarKey, "storage"] as const;
export const smartUnitsKey = [...smartStorageKey, "units"] as const;
export const smartPlacementsKey = (unitId: string) =>
  [...smartStorageKey, "placements", unitId] as const;

/**
 * What the server offers, asked once a visit: above all whether the database has the Smart Cellar step at all.
 * It does not change while the app is open, so it is not asked again on focus.
 */
export const useSmartCapabilities = (enabled: boolean) =>
  useQuery({
    queryKey: smartCapabilitiesKey,
    queryFn: () => api.get<SmartCellarCapabilities>("/smart-cellar"),
    enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

/** Every place of the household: which have a template, how full they are. No bottles. */
export const useSmartUnits = (enabled: boolean) =>
  useQuery({
    queryKey: smartUnitsKey,
    queryFn: () => api.get<SmartStorageUnitView[]>("/smart-cellar/storage"),
    enabled,
  });

/**
 * One place and every bottle on a spot in it, each with its whole spot (row, col, index). Asked for the place that
 * is on screen only. The cache is per place, so what is shown for one place can never be another's; while a place
 * is refreshed, what was last known about it stays on screen (and when nothing changed, the very same objects come
 * back, so a bottle that is out stays out).
 */
export const useSmartPlacements = (unitId: string | null) =>
  useQuery({
    queryKey: smartPlacementsKey(unitId ?? "none"),
    queryFn: () => api.get<SmartStoragePlacementsView>(`/smart-cellar/storage/${unitId}/bottles`),
    enabled: unitId !== null,
    // The place on screen is checked again whenever it is come back to (the tab, the place, the view): someone
    // else in the household may have taken a bottle out of it. What is cached is shown meanwhile.
    staleTime: 0,
  });
