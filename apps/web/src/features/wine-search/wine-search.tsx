"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import {
  CATALOG_SEARCH,
  matchesSearch,
  needsConfirmation,
  type CatalogSearchHit,
  type WineSummary,
} from "@cellr/domain";
import { OwnedPill, WineStage } from "@/features/cellar/wine-stage";
import { placeLine } from "@/features/cellar/wine-visuals";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { CheckIcon, ChevronRightIcon, SearchIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/skeleton";
import { useWineSearch } from "./use-wine-search";

const VISIBLE = CATALOG_SEARCH.defaultLimit;

/** One row of the list: a result of the server's search, or a wine from the household's own list. */
type Option =
  | { key: string; kind: "hit"; hit: CatalogSearchHit }
  | { key: string; kind: "local"; wine: WineSummary };

/** A CELLR wine among the results, as the rest of the app knows a wine. Null for a provider record. */
export function wineOfHit(hit: CatalogSearchHit): WineSummary | null {
  if (hit.kind !== "wine" || !hit.wineId || !hit.type) return null;
  return {
    id: hit.wineId,
    producer: hit.producer,
    name: hit.name,
    type: hit.type,
    countryCode: hit.countryCode,
    region: hit.region,
    // only a canonical wine is the catalogue's: the database says so, never the client
    catalog: hit.verified,
  };
}

export interface WineSearchProps {
  /** The text in the field: owned by the screen, so going back and forth never loses it. */
  value: string;
  onValue: (value: string) => void;
  label: string;
  placeholder: string;
  autoFocus?: boolean;
  /**
   * The household's own list. Shown when nothing is typed, and searched here when the server search cannot be used
   * (not deployed yet, offline, too many searches): the screen never ends up empty-handed.
   */
  localWines: WineSummary[] | undefined;
  /** The title over the own list when nothing is typed. */
  idleTitle: string;
  /** Rows of the own list bottles are counted for (the cellar's own counts), when the screen has them. */
  ownedCounts?: ReadonlyMap<string, number>;
  selectedId?: string | undefined;
  /**
   * A CELLR wine was chosen: the household's own or the catalogue's. `hit` is the search result it came from, or
   * null when it was chosen from the own list (nothing typed, or the search could not be used).
   */
  onWine: (wine: WineSummary, hit: CatalogSearchHit | null) => void;
  /** A record of an external source was chosen: it is never a CELLR wine; the person confirms its details. */
  onRecord: (hit: CatalogSearchHit) => void;
}

/**
 * THE WINE SEARCH FIELD (Wine Intelligence WI-02): one component for "add a bottle" and for Koopcheck. Type a
 * producer or a wine; ranked results come from the database (the household's own wines, the CELLR catalogue, and
 * sources CELLR may show). It is a combobox with a list that stays on the page: arrow keys move, Enter chooses,
 * Escape lets go; a screen reader hears how many results there are. A result is only ever a suggestion the person
 * chooses; what they typed is never changed, and every way it can fail leaves the own list and manual entry.
 */
export function WineSearch({
  value,
  onValue,
  label,
  placeholder,
  autoFocus,
  localWines,
  idleTitle,
  ownedCounts,
  selectedId,
  onWine,
  onRecord,
}: WineSearchProps) {
  const t = useTranslations("wineSearch");
  const tTypes = useTranslations("wineTypes");
  const locale = useLocale();
  const search = useWineSearch(value);
  const inputId = useId();
  const listId = useId();
  const hintId = useId();
  const [active, setActive] = useState<string | null>(null);
  const [showAll, setShowAll] = useState<string | null>(null);

  const typed = value.trim();
  /** Not null: the server search cannot be used right now, and the own list is shown instead. */
  const fallbackReason =
    search.status === "unavailable" ||
    search.status === "limited" ||
    search.status === "offline" ||
    search.status === "error"
      ? search.status
      : null;
  const fallback = fallbackReason !== null;
  // While waiting for a newer answer the earlier results stay; they are marked as not final for assistive tech.
  const waiting = search.status === "loading";

  const options = useMemo<Option[]>(() => {
    if (search.status === "idle" || fallback) {
      const own = (localWines ?? []).filter((w) =>
        typed ? matchesSearch([w.producer, w.name, w.region ?? ""], typed) : true,
      );
      return own.slice(0, VISIBLE).map((wine) => ({ key: `w:${wine.id}`, kind: "local", wine }));
    }
    const all = search.results.map<Option>((hit) => ({
      key: hit.kind === "record" ? `r:${hit.recordId}` : `w:${hit.wineId}`,
      kind: "hit",
      hit,
    }));
    return showAll === search.query ? all : all.slice(0, VISIBLE);
  }, [search.status, search.results, search.query, fallback, localWines, typed, showAll]);

  const hidden =
    search.status === "ready" || waiting ? Math.max(0, search.results.length - options.length) : 0;
  const activeIndex = options.findIndex((o) => o.key === active);
  const optionId = (key: string) => `${listId}-${key.replace(/[^a-zA-Z0-9]/g, "-")}`;

  function choose(option: Option) {
    if (option.kind === "local") return onWine(option.wine, null);
    const wine = wineOfHit(option.hit);
    if (wine) onWine(wine, option.hit);
    else onRecord(option.hit);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const move = (to: number) => {
      event.preventDefault();
      const next = options[(to + options.length) % options.length];
      if (!next) return;
      setActive(next.key);
      document.getElementById(optionId(next.key))?.scrollIntoView({ block: "nearest" });
    };
    if (event.key === "ArrowDown") move(activeIndex + 1);
    else if (event.key === "ArrowUp") move(activeIndex < 0 ? options.length - 1 : activeIndex - 1);
    else if (event.key === "Home" && activeIndex >= 0) move(0);
    else if (event.key === "End" && activeIndex >= 0) move(options.length - 1);
    else if (event.key === "Enter") {
      // Enter in a search field must never submit a surrounding form by accident.
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option);
    } else if (event.key === "Escape" && active !== null) {
      event.preventDefault();
      setActive(null);
    }
  }

  const announcement =
    search.status === "loading"
      ? t("searching")
      : search.status === "ready"
        ? t("count", { count: search.results.length })
        : fallback && typed
          ? t("count", { count: options.length })
          : "";

  return (
    <div className="flex flex-col gap-4" data-testid="wine-search" data-status={search.status}>
      <div className="relative">
        <SearchIcon
          size={20}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
        />
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
        <input
          id={inputId}
          type="search"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(options[activeIndex]!.key) : undefined}
          aria-describedby={hintId}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={CATALOG_SEARCH.maxInput}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            setActive(null);
            onValue(e.target.value);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "h-14 w-full min-w-0 rounded-full border border-hairline bg-surface pl-12 pr-5 text-body text-ink placeholder:text-ink-3",
            "transition-colors duration-150 ease-cellr focus-visible:border-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-fg/30",
          )}
        />
        <p id={hintId} className="sr-only">
          {t("keyboardHint")}
        </p>
      </div>

      {/* What changed, for a screen reader: said once per change, never per keystroke of an unfinished request. */}
      <p role="status" aria-live="polite" className="sr-only" data-testid="wine-search-status">
        {announcement}
      </p>

      {fallbackReason && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card bg-accent/10 px-4 py-3 text-small text-ink ring-1 ring-accent-fg/30"
          data-testid="wine-search-notice"
          data-reason={search.status}
        >
          <p className="min-w-0 flex-1">{t(`notice.${fallbackReason}`)}</p>
          {(fallbackReason === "offline" || fallbackReason === "error") && (
            <Button variant="ghost" size="sm" onClick={search.retry}>
              {t("retry")}
            </Button>
          )}
        </div>
      )}

      {localWines === undefined && (search.status === "idle" || fallback) ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-[5.25rem] rounded-card" />
          <Skeleton className="h-[5.25rem] rounded-card" />
        </div>
      ) : waiting && search.results.length === 0 ? (
        <div className="flex flex-col gap-3" aria-hidden="true" data-testid="wine-search-loading">
          <Skeleton className="h-[5.25rem] rounded-card" />
          <Skeleton className="h-[5.25rem] rounded-card" />
        </div>
      ) : (
        <section aria-labelledby={options.length > 0 ? `${listId}-title` : undefined}>
          {options.length > 0 && (
            <h2
              id={`${listId}-title`}
              className="mb-3 px-1 text-caption font-medium uppercase tracking-[0.14em] text-ink-3"
            >
              {search.status === "idle" ? idleTitle : fallback ? t("ownTitle") : t("resultsTitle")}
            </h2>
          )}
          <ul
            id={listId}
            role="listbox"
            aria-label={t("resultsTitle")}
            aria-busy={waiting}
            hidden={options.length === 0}
            className={cn("flex flex-col gap-3", waiting && "opacity-70")}
          >
            {options.map((option) => {
              const isActive = option.key === active;
              const wine = option.kind === "local" ? option.wine : null;
              const hit = option.kind === "hit" ? option.hit : null;
              const producer = wine?.producer ?? hit!.producer;
              const name = wine?.name ?? hit!.name;
              const type = wine?.type ?? hit!.type;
              const where = placeLine(
                wine?.region ?? hit?.region ?? null,
                wine?.countryCode ?? hit?.countryCode ?? null,
                locale,
              );
              const id = wine?.id ?? hit?.wineId ?? null;
              const selected = id !== null && id === selectedId;
              const bottles = wine ? (ownedCounts?.get(wine.id) ?? 0) : hit!.bottles;
              return (
                <li
                  key={option.key}
                  id={optionId(option.key)}
                  role="option"
                  aria-selected={isActive}
                  data-testid="wine-option"
                  data-source={wine ? "local" : hit!.source}
                  data-match={hit?.match}
                  onClick={() => choose(option)}
                  onMouseMove={() => (isActive ? undefined : setActive(option.key))}
                  className={cn(
                    "flex min-h-[5.25rem] cursor-pointer items-center gap-3.5 rounded-card bg-surface p-3 text-left shadow-raised transition-transform duration-150 ease-cellr active:scale-[0.98]",
                    selected || isActive ? "ring-2 ring-accent-fg" : "ring-1 ring-hairline",
                  )}
                >
                  <WineStage
                    type={type ?? "red"}
                    muted={type === null}
                    producer={producer}
                    name={name}
                    size="thumb"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption font-medium uppercase tracking-[0.14em] text-bronze">
                      {producer}
                    </span>
                    <span className="mt-0.5 block line-clamp-2 font-display text-title text-ink">
                      {name}
                    </span>
                    <span className="mt-0.5 block text-small text-ink-2">
                      {[type ? tTypes(type) : null, where].filter(Boolean).join(" · ")}
                    </span>
                    {hit?.matchedAlias && (
                      <span className="mt-0.5 block text-caption text-ink-3">
                        {t("alias", { alias: hit.matchedAlias })}
                      </span>
                    )}
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {bottles > 0 && <OwnedPill count={bottles} />}
                      {hit && bottles === 0 && (
                        <Badge tone={hit.source === "provider" ? "warn" : "plain"}>
                          {t(`source.${hit.source}`)}
                        </Badge>
                      )}
                      {hit?.provider && <Badge tone="plain">{hit.provider.name}</Badge>}
                      {hit &&
                        hit.kind === "wine" &&
                        hit.match === "fuzzy" &&
                        needsConfirmation(hit) && <Badge tone="plain">{t("similar")}</Badge>}
                    </span>
                  </span>
                  {selected ? (
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
                      <CheckIcon size={16} />
                    </span>
                  ) : (
                    <ChevronRightIcon
                      size={20}
                      aria-hidden="true"
                      className="shrink-0 text-ink-3"
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {hidden > 0 && search.query !== null && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() => setShowAll(search.query)}
              data-testid="wine-search-more"
            >
              {t("more", { count: hidden })}
            </Button>
          )}
          {search.status === "ready" && search.results.length === 0 && (
            <p className="px-1 text-small text-ink-2" data-testid="wine-search-empty">
              {t("none", { query: typed })}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "plain" | "warn" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-caption font-semibold",
        tone === "warn" ? "bg-accent/10 text-ink ring-1 ring-accent-fg/30" : "bg-raised text-ink-2",
      )}
    >
      {children}
    </span>
  );
}
