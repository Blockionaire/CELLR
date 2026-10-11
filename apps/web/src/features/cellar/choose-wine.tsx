"use client";

import { useLocale, useTranslations } from "next-intl";
import { matchesSearch, type WineSummary } from "@cellr/domain";
import { Field } from "@/ui/field";
import { PlusIcon, SearchIcon } from "@/ui/icons";
import { Skeleton } from "@/ui/skeleton";
import { placeLine } from "./wine-visuals";

const MAX_RESULTS = 8;

interface ChooseWineProps {
  wines: WineSummary[] | undefined;
  query: string;
  onQuery: (value: string) => void;
  onPick: (wine: WineSummary) => void;
  onNew: () => void;
}

/** Step 1: find the wine in your own list as you type, or add it. Everything is local, so it's instant. */
export function ChooseWine({ wines, query, onQuery, onPick, onNew }: ChooseWineProps) {
  const t = useTranslations("addBottle");
  const tTypes = useTranslations("wineTypes");
  const locale = useLocale();
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
          inputClassName="pl-11"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>

      {wines === undefined ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : (
        shown.length > 0 && (
          <section aria-label={q ? t("matches") : t("recent")}>
            <h2 className="mb-2 text-caption font-medium uppercase tracking-[0.18em] text-ink-3">
              {q ? t("matches") : t("recent")}
            </h2>
            <ul className="divide-y divide-hairline overflow-hidden rounded-card border border-hairline bg-surface">
              {shown.map((wine) => (
                <li key={wine.id}>
                  <button
                    type="button"
                    onClick={() => onPick(wine)}
                    className="flex min-h-16 w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-raised active:bg-raised"
                  >
                    <span className="text-caption font-medium uppercase tracking-[0.12em] text-ink-3">
                      {wine.producer}
                    </span>
                    <span className="font-display text-title text-ink">{wine.name}</span>
                    <span className="flex items-center gap-2 text-small text-ink-2">
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full"
                        style={{ background: `var(--wine-${wine.type})` }}
                      />
                      {tTypes(wine.type)}
                      {placeLine(wine.region, wine.countryCode, locale) &&
                        ` · ${placeLine(wine.region, wine.countryCode, locale)}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      )}

      <button
        type="button"
        onClick={onNew}
        className="flex min-h-14 items-center gap-3 rounded-card border border-dashed border-hairline px-4 text-left text-body text-ink transition-colors hover:bg-raised active:bg-raised"
      >
        <span className="grid size-8 place-items-center rounded-full bg-accent text-accent-ink">
          <PlusIcon size={18} />
        </span>
        {q ? t("newWineFromQuery", { name: q }) : t("newWine")}
      </button>
    </div>
  );
}
