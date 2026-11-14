"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { matchesSearch, type CatalogSearchHit, type WineSummary } from "@cellr/domain";
import dynamic from "next/dynamic";
import { Field } from "@/ui/field";
import { ChevronRightIcon, PlusIcon, ScanIcon, SearchIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/skeleton";
import { useOwnedCounts, WineChoice } from "./wine-stage";
import { placeLine } from "./wine-visuals";

const MAX_RESULTS = 8;

/**
 * The database-backed search is loaded only where it is switched on: a screen that still filters its own list (and
 * the scanner, which shows this picker only after a photo) downloads and starts exactly what it did before.
 */
const WineSearch = dynamic(
  () => import("@/features/wine-search/wine-search").then((m) => m.WineSearch),
  {
    // Not in the server's HTML: a search field that is on screen before it works loses what is typed into it.
    // The skeleton stands in until the field can answer, and then it takes the focus.
    ssr: false,
    loading: () => (
      <div className="flex flex-col gap-3" aria-hidden="true">
        <Skeleton className="h-14 rounded-full" />
        <Skeleton className="h-[5.25rem] rounded-card" />
      </div>
    ),
  },
);

interface ChooseWineProps {
  wines: WineSummary[] | undefined;
  query: string;
  onQuery: (value: string) => void;
  onPick: (wine: WineSummary) => void;
  onNew: () => void;
  /** The wine chosen so far (when coming back with "Change"): marked with a ring and a check. */
  selectedId?: string | undefined;
  /** Adding bottles: scanning the label comes first, as the quickest way (the existing scanner, at this address). */
  scanHref?: string | undefined;
  /**
   * The `wine_search` feature: the list comes from the database search (the household's wines, the catalogue and
   * sources CELLR may show) instead of filtering the fetched list here. A record of an external source is never a
   * CELLR wine: the screen opens the "new wine" form with its details for the person to confirm. Absent = as before.
   */
  catalog?:
    { onRecord: (hit: CatalogSearchHit) => void; surface?: "add" | "scan" | undefined } | undefined;
}

/** Step 1: find the wine in your own list as you type, or add it. Everything is local, so it's instant. */
export function ChooseWine({
  wines,
  query,
  onQuery,
  onPick,
  onNew,
  selectedId,
  scanHref,
  catalog,
}: ChooseWineProps) {
  const t = useTranslations("addBottle");
  const owned = useOwnedCounts();
  const q = query.trim();

  return (
    <div className="flex flex-col gap-6">
      {scanHref && (
        <Link
          href={scanHref}
          data-testid="scan-wine"
          className="group flex items-center gap-4 rounded-card bg-hero p-4 text-hero-ink shadow-raised transition-transform duration-150 ease-cellr active:scale-[0.98]"
        >
          <span className="grid size-14 shrink-0 place-items-center rounded-full bg-hero-gold text-[#2a0f16]">
            <ScanIcon size={26} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-title">{t("scanTitle")}</span>
            <span className="block text-small text-hero-ink/75">{t("scanBody")}</span>
          </span>
          <ChevronRightIcon
            size={20}
            aria-hidden="true"
            className="shrink-0 text-hero-gold transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </Link>
      )}
      {catalog ? (
        <WineSearch
          value={query}
          onValue={onQuery}
          label={t("searchLabel")}
          placeholder={t("searchPlaceholder")}
          autoFocus
          localWines={wines}
          idleTitle={t("recent")}
          ownedCounts={owned}
          selectedId={selectedId}
          onWine={onPick}
          onRecord={catalog.onRecord}
          surface={catalog.surface ?? "add"}
        />
      ) : (
        <LocalList
          wines={wines}
          query={query}
          onQuery={onQuery}
          onPick={onPick}
          selectedId={selectedId}
        />
      )}

      <button
        type="button"
        onClick={onNew}
        className="flex min-h-[5.25rem] items-center gap-3.5 rounded-card border border-dashed border-accent-fg/50 bg-surface/60 p-3 text-left transition-transform duration-150 ease-cellr active:scale-[0.98]"
      >
        <span className="grid h-[4.5rem] w-14 shrink-0 place-items-center rounded-[14px] bg-accent text-accent-ink glow">
          <PlusIcon size={24} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-title text-ink">
            {q ? t("newWineFromQuery", { name: q }) : t("newWine")}
          </span>
          {scanHref && <span className="block text-small text-ink-2">{t("newWineHint")}</span>}
        </span>
      </button>
    </div>
  );
}

/** The list as it was before the database search: the fetched wines, filtered here as you type. */
function LocalList({
  wines,
  query,
  onQuery,
  onPick,
  selectedId,
}: Pick<ChooseWineProps, "wines" | "query" | "onQuery" | "onPick" | "selectedId">) {
  const t = useTranslations("addBottle");
  const tTypes = useTranslations("wineTypes");
  const locale = useLocale();
  const owned = useOwnedCounts();
  const q = query.trim();
  const matches = (wines ?? []).filter((w) =>
    q ? matchesSearch([w.producer, w.name, w.region ?? ""], q) : true,
  );
  const shown = matches.slice(0, MAX_RESULTS);
  return (
    <>
      <div className="relative">
        <SearchIcon
          size={20}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
        />
        <Field
          label={t("searchLabel")}
          hideLabel
          type="search"
          autoFocus
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="search"
          placeholder={t("searchPlaceholder")}
          inputClassName="h-14 rounded-full pl-12 pr-5"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>

      {wines === undefined ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-[5.25rem] rounded-card" />
          <Skeleton className="h-[5.25rem] rounded-card" />
        </div>
      ) : (
        shown.length > 0 && (
          <section aria-label={q ? t("matches") : t("recent")}>
            <h2 className="mb-3 px-1 text-caption font-medium uppercase tracking-[0.14em] text-ink-3">
              {q ? t("matches") : t("recent")}
            </h2>
            <ul className="flex flex-col gap-3">
              {shown.map((wine) => {
                const where = placeLine(wine.region, wine.countryCode, locale);
                return (
                  <li key={wine.id}>
                    <WineChoice
                      wine={wine}
                      detail={[tTypes(wine.type), where].filter(Boolean).join(" · ")}
                      owned={owned.get(wine.id)}
                      selected={wine.id === selectedId}
                      onPick={() => onPick(wine)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        )
      )}
    </>
  );
}
