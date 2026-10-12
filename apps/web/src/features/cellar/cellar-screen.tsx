"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  activeFilterCount,
  applyFilters,
  formatVintage,
  matchesSearch,
  NO_FILTERS,
  sortItems,
  type CellarFilters,
  type CellarSort,
  type CellarView,
} from "@cellr/domain";
import { buttonStyles } from "@/ui/button";
import { EmptyState } from "@/ui/empty-state";
import { Field } from "@/ui/field";
import { PlusIcon, SearchIcon } from "@/ui/icons";
import { cn } from "@/ui/cn";
import { PageHeader } from "@/ui/page-header";
import { Segmented } from "@/ui/segmented";
import { ActiveFilters, FilterButton, FilterSheet } from "./cellar-filters";
import { useCellar } from "./hooks";
import { CELLAR_VIEW_COOKIE, type CellarViewMode } from "./view-mode";
import { Cellar3DView } from "./cellar-3d-view";
import { RacksView } from "./racks-view";
import { WineCard, WineRow } from "./wine-card";
import { countryName } from "./wine-visuals";

/**
 * What the person last searched, filtered and sorted by, kept for the life of this browser tab so that
 * going into a wine and coming back finds the list as it was. (Browser only: the server never sets it.)
 */
const memory: { query: string; filters: CellarFilters; sort: CellarSort } = {
  query: "",
  filters: NO_FILTERS,
  sort: "recent",
};

const rememberView = (view: CellarViewMode) => {
  document.cookie = `${CELLAR_VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax`;
};

/**
 * The cellar: a premium grid or a compact list, with search that filters as you type.
 * The server renders the first paint with real data; changes elsewhere refresh it in the background.
 */
export function CellarScreen({
  initial,
  initialView,
}: {
  initial: CellarView;
  initialView: CellarViewMode;
}) {
  const t = useTranslations("cellar");
  const locale = useLocale();
  const { data } = useCellar(initial);
  const [view, setView] = useState<CellarViewMode>(initialView);
  const [query, setQueryState] = useState(() => memory.query);
  const [filters, setFiltersState] = useState(() => memory.filters);
  const [sort, setSortState] = useState(() => memory.sort);
  const [filterSheet, setFilterSheet] = useState(false);
  const setQuery = (next: string) => {
    memory.query = next;
    setQueryState(next);
  };
  const setFilters = (next: CellarFilters) => {
    memory.filters = next;
    setFiltersState(next);
  };
  const setSort = (next: CellarSort) => {
    memory.sort = next;
    setSortState(next);
  };

  const items = useMemo(
    () =>
      sortItems(
        applyFilters(
          data.items.filter((item) =>
            matchesSearch(
              [
                item.producer,
                item.wineName,
                formatVintage(item.year),
                item.region ?? "",
                countryName(item.countryCode, locale) ?? "",
                ...item.places,
              ],
              query,
            ),
          ),
          filters,
        ),
        sort,
      ),
    [data.items, query, filters, sort, locale],
  );
  const activeCount = activeFilterCount(filters) + (sort === "recent" ? 0 : 1);

  const addButton = (
    <div className="flex items-center gap-1">
      <Link href="/wishlist" className={buttonStyles({ variant: "ghost", size: "md" })}>
        {t("wishlist")}
      </Link>
      <Link href="/cellar/add" className={buttonStyles({ variant: "primary", size: "md" })}>
        <PlusIcon size={20} />
        {t("add")}
      </Link>
    </div>
  );

  if (data.items.length === 0) {
    return (
      <>
        <PageHeader title={t("title")} />
        <EmptyState
          title={t("emptyTitle")}
          body={t("emptyBody")}
          action={
            <Link href="/cellar/add" className={buttonStyles({ variant: "primary", size: "lg" })}>
              {t("emptyAction")}
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("summary", { bottles: data.bottleCount, wines: data.items.length })}
        actions={addButton}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div
          className={cn(
            "flex min-w-0 flex-1 basis-full items-center gap-3 sm:basis-0",
            (view === "racks" || view === "3d") && "hidden sm:flex sm:invisible",
          )}
        >
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              size={20}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
            />
            <Field
              label={t("searchLabel")}
              hideLabel
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              placeholder={t("searchPlaceholder")}
              inputClassName="pl-11"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <FilterButton active={activeCount} onClick={() => setFilterSheet(true)} />
        </div>
        <Segmented
          label={t("viewLabel")}
          value={view}
          onChange={(next) => {
            setView(next);
            rememberView(next);
          }}
          options={[
            { value: "grid", label: t("viewGrid") },
            { value: "list", label: t("viewList") },
            { value: "racks", label: t("viewRacks") },
            { value: "3d", label: t("view3d") },
          ]}
          className="ml-auto"
        />
      </div>
      {(view === "grid" || view === "list") && (
        <ActiveFilters filters={filters} onChange={setFilters} />
      )}

      {view === "3d" ? (
        <Cellar3DView
          onShowRacks={() => {
            setView("racks");
            rememberView("racks");
          }}
        />
      ) : view === "racks" ? (
        <RacksView />
      ) : items.length === 0 ? (
        <EmptyState
          illustration={false}
          title={t("noMatchTitle")}
          body={t("noMatchBody")}
          action={
            <button
              type="button"
              className={buttonStyles({ variant: "secondary", size: "md" })}
              onClick={() => {
                setQuery("");
                setFilters(NO_FILTERS);
              }}
            >
              {t("clearSearch")}
            </button>
          }
        />
      ) : view === "grid" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((item) => (
            <li key={item.vintageId}>
              <WineCard item={item} locale={locale} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-hairline rounded-card border border-hairline bg-surface px-4">
          {items.map((item) => (
            <li key={item.vintageId}>
              <WineRow item={item} locale={locale} />
            </li>
          ))}
        </ul>
      )}

      <FilterSheet
        open={filterSheet}
        onClose={() => setFilterSheet(false)}
        items={data.items}
        filters={filters}
        onFilters={setFilters}
        sort={sort}
        onSort={setSort}
        matches={items.length}
      />
    </>
  );
}
