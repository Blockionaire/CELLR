"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  activeFilterCount,
  applyFilters,
  facetsOf,
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
import { Chip } from "@/ui/chip";
import { HeartIcon, PlusIcon, SearchIcon, type IconProps } from "@/ui/icons";
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

/** Small outline icons for the related-pages pills (same 24px grid as @/ui/icons). */
function PillIcon({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}
const ClockIcon = (p: IconProps) => (
  <PillIcon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </PillIcon>
);
const BarsIcon = (p: IconProps) => (
  <PillIcon {...p}>
    <path d="M5 20V12M12 20V5M19 20v-5" />
  </PillIcon>
);

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
  const tTypes = useTranslations("wineTypes");
  const tFilters = useTranslations("cellarFilters");
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
  const typeFacets = useMemo(() => facetsOf(data.items).types, [data.items]);

  const addButton = (
    <Link href="/cellar/add" className={buttonStyles({ variant: "primary", size: "md" })}>
      <PlusIcon size={20} />
      {t("add")}
    </Link>
  );

  /** The other places that belong to the cellar: kept out of the title row, which would squeeze the title. */
  const related = (
    <nav
      aria-label={t("related")}
      className="-mx-5 mb-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {[
        { href: "/wishlist", label: t("wishlist"), Icon: HeartIcon },
        { href: "/cellar/history", label: t("history"), Icon: ClockIcon },
        { href: "/insights", label: t("insights"), Icon: BarsIcon },
      ].map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-surface px-3.5 text-small font-medium text-ink-2 transition-colors duration-150 ease-cellr hover:text-ink active:scale-[0.98]"
        >
          <l.Icon size={16} className="text-bronze" />
          {l.label}
        </Link>
      ))}
    </nav>
  );

  if (data.items.length === 0) {
    return (
      <>
        <PageHeader title={t("title")} />
        {related}
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
      {related}

      <div className="sticky top-0 z-10 -mx-5 mb-4 flex flex-wrap items-center gap-3 bg-canvas/90 px-5 py-2 backdrop-blur-xl sm:static sm:z-auto sm:mx-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none md:mb-5">
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
              inputClassName="rounded-full pl-11"
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
          className="w-full sm:ml-auto sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none"
        />
      </div>
      {(view === "grid" || view === "list") && typeFacets.length > 1 && (
        <ul
          aria-label={tFilters("type")}
          className="-mx-5 mb-4 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden"
        >
          <li className="shrink-0">
            <Chip
              selected={filters.types.length === 0}
              onClick={() => setFilters({ ...filters, types: [] })}
            >
              {t("typeAll")}
            </Chip>
          </li>
          {typeFacets.map((f) => (
            <li key={f.value} className="shrink-0">
              <Chip
                selected={filters.types.includes(f.value)}
                onClick={() =>
                  setFilters({
                    ...filters,
                    types: filters.types.includes(f.value)
                      ? filters.types.filter((v) => v !== f.value)
                      : [...filters.types, f.value],
                  })
                }
                className="inline-flex items-center gap-2"
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full ring-1 ring-ink/15"
                  style={{ backgroundColor: `var(--wine-${f.value})` }}
                />
                {tTypes(f.value)}
                <span className="tnum opacity-70">{f.count}</span>
              </Chip>
            </li>
          ))}
        </ul>
      )}
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
        <ul className="divide-y divide-hairline rounded-card bg-surface px-4 ring-1 ring-hairline">
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
