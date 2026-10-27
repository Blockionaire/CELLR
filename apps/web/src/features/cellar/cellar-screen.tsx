"use client";

import Link from "next/link";
import { InsightsEntry } from "@/features/stats/insights-entry";
import { useLocale, useTranslations } from "next-intl";
import { startTransition, useEffect, useMemo, useState, ViewTransition } from "react";
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
import { HeartIcon, PlusIcon, SearchIcon, StarIcon, type IconProps } from "@/ui/icons";
import { Sheet } from "@/ui/sheet";
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
 * What the person last searched, filtered and sorted by, which view they were in and how far they had scrolled,
 * kept for the life of this browser tab so that going into a wine and coming back finds the cellar as it was.
 * (Browser only: the server never sets it.) The view must come from here, not only from the server's cookie:
 * on Back the router reuses the page as it was first rendered, with the view the cookie held THEN.
 */
const memory: {
  query: string;
  filters: CellarFilters;
  sort: CellarSort;
  view: CellarViewMode | null;
  scrollY: number;
} = {
  query: "",
  filters: NO_FILTERS,
  sort: "recent",
  view: null,
  scrollY: 0,
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

const GridIcon = (p: IconProps) => (
  <PillIcon {...p}>
    <rect x="4" y="4" width="6.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="4" width="6.5" height="7.5" rx="1.5" />
    <rect x="4" y="14.5" width="6.5" height="5.5" rx="1.5" />
    <rect x="13.5" y="14.5" width="6.5" height="5.5" rx="1.5" />
  </PillIcon>
);
const ListIcon = (p: IconProps) => (
  <PillIcon {...p}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <circle cx="4.75" cy="6.5" r="0.9" fill="currentColor" />
    <circle cx="4.75" cy="12" r="0.9" fill="currentColor" />
    <circle cx="4.75" cy="17.5" r="0.9" fill="currentColor" />
  </PillIcon>
);
const RackIcon = (p: IconProps) => (
  <PillIcon {...p}>
    <rect x="3.5" y="4" width="17" height="16" rx="2" />
    <path d="M3.5 12h17" />
    <circle cx="8" cy="8" r="1.6" />
    <circle cx="12" cy="8" r="1.6" />
    <circle cx="16" cy="16" r="1.6" />
  </PillIcon>
);
const CubeIcon = (p: IconProps) => (
  <PillIcon {...p}>
    <path d="M12 3.5 19.5 7.5v9L12 20.5 4.5 16.5v-9L12 3.5Z" />
    <path d="M4.5 7.5 12 11.5l7.5-4M12 11.5v9" />
  </PillIcon>
);
const MoreIcon = (p: IconProps) => (
  <PillIcon {...p}>
    <circle cx="6" cy="12" r="1.1" fill="currentColor" />
    <circle cx="12" cy="12" r="1.1" fill="currentColor" />
    <circle cx="18" cy="12" r="1.1" fill="currentColor" />
  </PillIcon>
);

/** Above this many wines a change of filter simply redraws: animating hundreds of cards would stutter. */
const ANIMATE_UP_TO = 60;

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
  const [view, setViewState] = useState<CellarViewMode>(() => memory.view ?? initialView);
  const setView = (next: CellarViewMode) => {
    memory.view = next;
    memory.scrollY = 0;
    setViewState(next);
  };
  // Back to where you were: remember the scroll as you go, put it back when the cellar returns. Content is there
  // on the first frame (cached data), and a page too short to reach it simply stops at its end.
  useEffect(() => {
    const y = memory.scrollY;
    if (y > 0) requestAnimationFrame(() => window.scrollTo({ top: y }));
    const keep = () => {
      // Once the URL has moved on (a wine was opened), the next page's jump to the top is not ours to keep.
      if (window.location.pathname === "/cellar") memory.scrollY = window.scrollY;
    };
    window.addEventListener("scroll", keep, { passive: true });
    return () => window.removeEventListener("scroll", keep);
  }, []);
  const [query, setQueryState] = useState(() => memory.query);
  const [filters, setFiltersState] = useState(() => memory.filters);
  const [sort, setSortState] = useState(() => memory.sort);
  const [filterSheet, setFilterSheet] = useState(false);
  const setQuery = (next: string) => {
    memory.query = next;
    setQueryState(next);
  };
  // Filters and sort change inside a transition: the cards that stay glide to their new places.
  const setFilters = (next: CellarFilters) => {
    memory.filters = next;
    startTransition(() => setFiltersState(next));
  };
  const setSort = (next: CellarSort) => {
    memory.sort = next;
    startTransition(() => setSortState(next));
  };
  const [moreOpen, setMoreOpen] = useState(false);

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
    <Link
      href="/cellar/add"
      aria-label={t("add")}
      title={t("add")}
      className="glow inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full bg-accent text-body font-medium text-accent-ink transition-[transform,filter] duration-200 ease-spring hover:brightness-110 active:scale-[0.94] sm:px-5"
    >
      <PlusIcon size={20} className="shrink-0" />
      <span className="hidden sm:inline">{t("add")}</span>
    </Link>
  );

  /** The other places that belong to the cellar: one quiet button, a short list behind it. */
  const related = [
    { href: "/wishlist", label: t("wishlist"), Icon: HeartIcon },
    { href: "/ratings", label: t("ratings"), Icon: StarIcon },
    { href: "/cellar/history", label: t("history"), Icon: ClockIcon },
    { href: "/insights", label: t("insights"), Icon: BarsIcon },
  ];
  const moreButton = (
    <button
      type="button"
      aria-label={t("related")}
      title={t("related")}
      aria-haspopup="dialog"
      onClick={() => setMoreOpen(true)}
      className="grid size-11 shrink-0 place-items-center rounded-full border border-hairline bg-surface text-ink transition-[transform,background-color] duration-200 ease-spring hover:bg-raised active:scale-[0.94]"
    >
      <MoreIcon size={20} />
    </button>
  );
  const moreSheet = (
    <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={t("related")}>
      <nav aria-label={t("related")}>
        <ul className="flex flex-col">
          {related.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                onClick={() => setMoreOpen(false)}
                className="flex min-h-14 items-center gap-4 rounded-[16px] px-3 text-body font-medium text-ink transition-colors duration-150 hover:bg-raised"
              >
                <l.Icon size={20} className="text-bronze" />
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </Sheet>
  );

  if (data.items.length === 0) {
    return (
      <>
        <PageHeader title={t("title")} actions={moreButton} />
        <EmptyState
          title={t("emptyTitle")}
          body={t("emptyBody")}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/scan" className={buttonStyles({ variant: "primary", size: "lg" })}>
                {t("emptyScan")}
              </Link>
              <Link
                href="/cellar/add"
                className={buttonStyles({ variant: "secondary", size: "lg" })}
              >
                {t("emptyAction")}
              </Link>
            </div>
          }
        />
        {moreSheet}
      </>
    );
  }

  const animate = items.length <= ANIMATE_UP_TO;
  const collection = view === "grid" || view === "list";

  return (
    <>
      <header className="flex items-end justify-between gap-3 pb-4 pt-6 lg:pb-5 lg:pt-12">
        <div className="min-w-0">
          <h1 className="font-display text-[2.25rem] leading-[2.5rem] tracking-[-0.01em] lg:text-[3rem] lg:leading-[3.25rem]">
            {t("title")}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {moreButton}
          {addButton}
        </div>
      </header>

      {/* The collection in numbers, and the way into Insights (the counts used to sit under the title). */}
      <InsightsEntry
        className="mb-3"
        summary={t("summary", { bottles: data.bottleCount, wines: data.items.length })}
      />

      <div
        className={cn(
          "sticky-bar sticky top-0 z-10 -mx-5 mb-2 px-5 py-2 sm:mx-0 sm:px-0",
          !collection && "hidden",
        )}
      >
        <div className="relative">
          <SearchIcon
            size={18}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <Field
            label={t("searchLabel")}
            hideLabel
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder={t("searchPlaceholder")}
            inputClassName="h-11 rounded-full pl-10 pr-16"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <FilterButton
            active={activeCount}
            onClick={() => setFilterSheet(true)}
            compact
            className="absolute right-1 top-1/2 h-9 -translate-y-1/2 border-0 bg-transparent px-2.5 hover:bg-raised"
          />
        </div>
      </div>
      <div className="mb-4 flex items-center gap-2">
        {collection && typeFacets.length > 1 && (
          <ul
            aria-label={tFilters("type")}
            className="-ml-5 flex min-w-0 flex-1 gap-2 overflow-x-auto py-1 pl-5 pr-2 scrollbar-none [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] md:ml-0 md:pl-0"
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
        <Segmented
          label={t("viewLabel")}
          value={view}
          onChange={(next) => {
            // at once: a whole new layout gains nothing from a morph, and must not wait on one
            setView(next);
            rememberView(next);
          }}
          options={[
            { value: "grid", label: t("viewGrid"), icon: <GridIcon size={18} /> },
            { value: "list", label: t("viewList"), icon: <ListIcon size={18} /> },
            { value: "racks", label: t("viewRacks"), icon: <RackIcon size={18} /> },
            { value: "3d", label: t("view3d"), icon: <CubeIcon size={18} /> },
          ]}
          className="ml-auto shrink-0 p-0.5"
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
        <ul className="grid grid-cols-2 gap-x-3.5 gap-y-6 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((item, i) => (
            <Card key={item.vintageId} id={item.vintageId} animate={animate}>
              <li className="reveal" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
                <WineCard item={item} locale={locale} shared={animate} />
              </li>
            </Card>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <Card key={item.vintageId} id={item.vintageId} animate={animate}>
              <li className="border-b border-hairline last:border-b-0">
                <WineRow item={item} locale={locale} shared={animate} />
              </li>
            </Card>
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
      {moreSheet}
    </>
  );
}

/** A card that glides to its new place when the filter or order changes (small cellars only, see above). */
function Card({
  id,
  animate,
  children,
}: {
  id: string;
  animate: boolean;
  children: React.ReactNode;
}) {
  return animate ? (
    <ViewTransition name={`card-${id}`} share="none" default="card-move">
      {children}
    </ViewTransition>
  ) : (
    children
  );
}
