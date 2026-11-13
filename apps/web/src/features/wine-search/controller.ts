import {
  CATALOG_SEARCH,
  searchableQuery,
  type CatalogSearchHit,
  type CatalogSearchResponse,
} from "@cellr/domain";

/**
 * WINE SEARCH AS YOU TYPE, without React: what is asked of the server, when, and what is shown. Kept apart from the
 * component so its promises can be tested with a fake clock and a fake server:
 *  - nothing is sent for a query too short to be a search, and nothing while the person is still typing (debounce);
 *  - at most one request is in flight: a newer one cancels the older, and an older answer that still arrives is
 *    ignored, so results can never jump back to an earlier query;
 *  - a query answered before is answered from memory (backspacing does not ask again);
 *  - "too many searches" stops asking for a while instead of retrying; "search is not available here" stops asking
 *    altogether; in both cases, and offline, the screen falls back to its own list and manual entry;
 *  - what the person typed is never changed by anything that comes back.
 */
export type SearchStatus =
  /** Nothing to search for (empty or too short). */
  | "idle"
  /** Waiting for the person to pause, or for the server. Earlier results stay on screen meanwhile. */
  | "loading"
  | "ready"
  /** The search endpoint does not exist in this deployment: use the local list. Not asked again. */
  | "unavailable"
  /** Too many searches: not asked again until the cool-down has passed. */
  | "limited"
  /** The server could not be reached. */
  | "offline"
  | "error";

export interface SearchState {
  /** Exactly what is in the field. */
  input: string;
  /** The normalised query the results below answer; null when there are none. */
  query: string | null;
  status: SearchStatus;
  results: CatalogSearchHit[];
}

/** A failed request, as far as the controller needs to know why. */
export type SearchFailure = "aborted" | "rate_limited" | "network" | "other";

export interface SearchControllerOptions {
  /** Asks the server. Rejects with anything; `classify` says what it was. */
  search: (query: string, signal: AbortSignal) => Promise<CatalogSearchResponse>;
  classify: (error: unknown) => SearchFailure;
  debounceMs?: number;
  /** How long nothing is asked after "too many searches". */
  cooldownMs?: number;
  cacheSize?: number;
  /**
   * How long an answer may be reused. Short on purpose: what may be shown can change while the screen is open (a
   * source switched off, a wine added in another tab), and the next search after this must ask the server again.
   */
  cacheTtlMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** How one search field was used: numbers and flags only. */
export interface SearchStats {
  requests: number;
  zeroResults: boolean;
  limited: boolean;
  failed: boolean;
  slowestMs: number;
}

export const SEARCH_SURFACES = ["add", "koopcheck", "scan"] as const;
export type SearchSurface = (typeof SEARCH_SURFACES)[number];

/**
 * The one anonymous event a used search field sends when it is done with (docs/METRICS.md): where it was, how it
 * ended, and coarse buckets. By construction it cannot hold the text typed, a wine's name or id, or a household:
 * every value is a number, a flag, or one of the fixed words below.
 */
export function searchSessionEvent(
  stats: SearchStats,
  end: {
    surface: SearchSurface;
    outcome: "selected" | "left";
    /** Which kind of result was chosen. */
    source?: "owned" | "household" | "catalog" | "provider" | "local" | undefined;
    /** Its place in the list, from 1. */
    rank?: number | undefined;
  },
): Record<string, string | number | boolean> {
  const rank = end.rank ?? 0;
  const ms = stats.slowestMs;
  return {
    surface: end.surface,
    outcome: end.outcome,
    requests: Math.min(stats.requests, 50),
    zero_results: stats.zeroResults,
    limited: stats.limited,
    failed: stats.failed,
    slowest:
      ms < 250
        ? "under_250ms"
        : ms < 700
          ? "under_700ms"
          : ms < 1500
            ? "under_1500ms"
            : "over_1500ms",
    ...(end.outcome === "selected"
      ? {
          source: end.source ?? "local",
          rank:
            rank <= 0
              ? "none"
              : rank === 1
                ? "1"
                : rank <= 3
                  ? "2_3"
                  : rank <= 8
                    ? "4_8"
                    : "9_plus",
        }
      : {}),
  };
}

export const SEARCH_DEFAULTS = {
  debounceMs: 250,
  cooldownMs: 30_000,
  cacheSize: 40,
  cacheTtlMs: 60_000,
} as const;

const IDLE: SearchState = { input: "", query: null, status: "idle", results: [] };

export function createSearchController(options: SearchControllerOptions) {
  const debounceMs = options.debounceMs ?? SEARCH_DEFAULTS.debounceMs;
  const cooldownMs = options.cooldownMs ?? SEARCH_DEFAULTS.cooldownMs;
  const cacheSize = options.cacheSize ?? SEARCH_DEFAULTS.cacheSize;
  const cacheTtlMs = options.cacheTtlMs ?? SEARCH_DEFAULTS.cacheTtlMs;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let state: SearchState = IDLE;
  const listeners = new Set<() => void>();
  const cache = new Map<string, { results: CatalogSearchHit[]; at: number }>();
  let timer: unknown = null;
  let inFlight: AbortController | null = null;
  /** Only the answer to the request with this number may change what is shown. */
  let sequence = 0;
  let limitedUntil = 0;
  /** Fires once when a cool-down ends, to ask again for what is typed then. */
  let resume: unknown = null;
  let unavailable = false;
  let disposed = false;
  let requests = 0;
  /** What happened in this field, as counts and flags only (never what was typed): for one anonymous event. */
  const seen = { zeroResults: false, limited: false, failed: false, slowestMs: 0 };

  const set = (next: SearchState) => {
    state = next;
    for (const l of listeners) l();
  };
  const cancelPending = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (resume !== null) clearTimer(resume);
    resume = null;
    inFlight?.abort();
    inFlight = null;
    sequence++;
  };
  const remember = (query: string, results: CatalogSearchHit[]) => {
    cache.delete(query);
    cache.set(query, { results, at: now() });
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
  };
  const recall = (query: string): CatalogSearchHit[] | null => {
    const known = cache.get(query);
    if (!known) return null;
    if (now() - known.at > cacheTtlMs) {
      cache.delete(query);
      return null;
    }
    return known.results;
  };

  /**
   * "Too many searches": the own list is shown, and when the cool-down ends the search asks ONCE more for what is
   * typed by then, so the notice does not stay until the person happens to type again.
   */
  const limited = (next: SearchState) => {
    if (resume !== null) clearTimer(resume);
    resume = setTimer(
      () => {
        resume = null;
        if (disposed || state.status !== "limited") return;
        const query = searchableQuery(state.input);
        if (query === null) return set({ ...state, status: "idle", query: null, results: [] });
        set({ ...state, status: "loading" });
        void ask(query);
      },
      Math.max(0, limitedUntil - now()),
    );
    set(next);
  };

  async function ask(query: string) {
    timer = null;
    if (disposed) return;
    if (unavailable) return set({ ...state, status: "unavailable", query: null, results: [] });
    if (now() < limitedUntil)
      return limited({ ...state, status: "limited", query: null, results: [] });
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    const mine = ++sequence;
    requests++;
    const startedAt = now();
    try {
      const response = await options.search(query, controller.signal);
      seen.slowestMs = Math.max(seen.slowestMs, now() - startedAt);
      if (disposed || mine !== sequence) return; // a newer query was typed meanwhile: this answer is stale
      inFlight = null;
      if (!response.available) {
        unavailable = true;
        return set({ ...state, status: "unavailable", query: null, results: [] });
      }
      // The server bounds its answer; a longer one is cut here too, whatever it sent.
      const results = response.results.slice(0, CATALOG_SEARCH.maxLimit);
      remember(query, results);
      if (results.length === 0) seen.zeroResults = true;
      set({ ...state, status: "ready", query, results });
    } catch (error) {
      if (disposed || mine !== sequence) return;
      inFlight = null;
      const why = options.classify(error);
      if (why === "aborted") return;
      if (why === "rate_limited") seen.limited = true;
      else seen.failed = true;
      if (why === "rate_limited") {
        limitedUntil = now() + cooldownMs;
        return limited({ ...state, status: "limited", query: null, results: [] });
      }
      set({ ...state, status: why === "network" ? "offline" : "error", query: null, results: [] });
    }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** The person typed (or the field was filled). Never throws. */
    setInput(input: string) {
      if (disposed) return;
      const query = searchableQuery(input);
      if (query === null) {
        cancelPending();
        return set({ input, query: null, status: "idle", results: [] });
      }
      // The same search with other spacing or capitals: nothing new to ask.
      if (
        query === state.query &&
        state.status === "ready" &&
        timer === null &&
        !inFlight &&
        recall(query) !== null
      )
        return set({ ...state, input });
      cancelPending();
      const known = recall(query);
      if (known) return set({ input, query, status: "ready", results: known });
      if (unavailable) return set({ input, query: null, status: "unavailable", results: [] });
      if (now() < limitedUntil)
        return limited({ input, query: null, status: "limited", results: [] });
      // earlier results stay visible while waiting, so the list does not flicker on every letter
      set({ ...state, input, status: "loading" });
      timer = setTimer(() => void ask(query), debounceMs);
    },
    /** Ask again now for what is typed (after "offline" or an error; after the cool-down for "limited"). */
    retry() {
      if (disposed) return;
      const query = searchableQuery(state.input);
      if (query === null || unavailable || now() < limitedUntil) return;
      cancelPending();
      set({ ...state, status: "loading" });
      void ask(query);
    },
    /**
     * The screen was left: whatever was pending is cancelled and a late answer is ignored. Unlike `dispose`, the
     * controller can be used again (React mounts, unmounts and mounts a screen again while developing).
     */
    cancel() {
      cancelPending();
    },
    /** How many requests were actually sent (for tests and for measuring). */
    requestCount: () => requests,
    /** Counts and flags of this field's use so far; nothing that was typed or found. */
    stats: (): SearchStats => ({ requests, ...seen }),
    dispose() {
      disposed = true;
      cancelPending();
      listeners.clear();
    },
  };
}

export type SearchController = ReturnType<typeof createSearchController>;
