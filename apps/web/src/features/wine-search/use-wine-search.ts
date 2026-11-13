"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CATALOG_SEARCH, type CatalogSearchResponse } from "@cellr/domain";
import { ApiError, api } from "@/lib/api";
import {
  createSearchController,
  type SearchController,
  type SearchFailure,
  type SearchState,
} from "./controller";

/** Why a search request failed, as the controller needs to know it. */
export function classifySearchError(error: unknown): SearchFailure {
  if (error instanceof ApiError)
    return error.code === "RATE_LIMITED"
      ? "rate_limited"
      : error.code === "NETWORK"
        ? "network"
        : "other";
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AbortError"
  )
    return "aborted";
  return "other";
}

/** One request to the search endpoint: the whole bounded page, so "show more" needs no second request. */
export const searchWines = (query: string, signal: AbortSignal) =>
  api.get<CatalogSearchResponse>(
    `/catalog/search?q=${encodeURIComponent(query)}&limit=${CATALOG_SEARCH.maxLimit}`,
    { signal },
  );

/**
 * Wine search as you type, for a field whose text the screen owns. The controller (debounce, cancelling, memory,
 * limits) lives as long as the component; leaving the screen cancels whatever was pending.
 */
export function useWineSearch(input: string): SearchState & { retry: () => void } {
  const [controller] = useState<SearchController>(() =>
    createSearchController({ search: searchWines, classify: classifySearchError }),
  );
  useEffect(() => () => controller.cancel(), [controller]);
  useEffect(() => controller.setInput(input), [controller, input]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  return { ...state, retry: controller.retry };
}
