"use client";

import { useLocale, useTranslations } from "next-intl";
import { matchesSearch, type WineSummary } from "@cellr/domain";
import { Field } from "@/ui/field";
import { PlusIcon, SearchIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/skeleton";
import { useOwnedCounts, WineChoice } from "./wine-stage";
import { placeLine } from "./wine-visuals";

const MAX_RESULTS = 8;

interface ChooseWineProps {
  wines: WineSummary[] | undefined;
  query: string;
  onQuery: (value: string) => void;
  onPick: (wine: WineSummary) => void;
  onNew: () => void;
  /** The wine chosen so far (when coming back with "Change"): marked with a ring and a check. */
  selectedId?: string | undefined;
}

/** Step 1: find the wine in your own list as you type, or add it. Everything is local, so it's instant. */
export function ChooseWine({ wines, query, onQuery, onPick, onNew, selectedId }: ChooseWineProps) {
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
    <div className="flex flex-col gap-6">
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

      <button
        type="button"
        onClick={onNew}
        className="flex min-h-[5.25rem] items-center gap-3.5 rounded-card border border-dashed border-accent-fg/50 bg-surface/60 p-3 text-left transition-transform duration-150 ease-cellr active:scale-[0.98]"
      >
        <span className="grid h-[4.5rem] w-14 shrink-0 place-items-center rounded-[14px] bg-accent text-accent-ink glow">
          <PlusIcon size={24} />
        </span>
        <span className="min-w-0 flex-1 font-display text-title text-ink">
          {q ? t("newWineFromQuery", { name: q }) : t("newWine")}
        </span>
      </button>
    </div>
  );
}
