"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { windowStretches, type DrinkSummary } from "@cellr/domain";
import { useInsight } from "@/features/insights/hooks";
import { ChevronRightIcon } from "@/ui/icons";
import { Sheet } from "@/ui/sheet";
import { chartYearRange, DrinkChart, PhasePill, phaseForYear } from "./drink-chart";
import { EYEBROW } from "./vintage-bits";

/**
 * "When to drink it", on a screen of its own (opened from the Drinkvenster tile, like "Where is it?" from the
 * Where tile): the window, today's phase, and the wine's life as a large chart to explore year by year, with
 * what the chosen year means underneath. Everything comes from the window the page already has (the same
 * estimate, the same rule for each phase) and, when the wine has an AI profile, what it said about ageing. No
 * new estimate is made here, and nothing is asked of the AI.
 */
export function DrinkSheet({
  open,
  onClose,
  vintageId,
  title,
  drink,
  year,
  opened,
}: {
  open: boolean;
  onClose: () => void;
  vintageId: string;
  /** The wine and vintage, under the sheet's title. */
  title: string;
  drink: DrinkSummary;
  year: number | null;
  opened: ReadonlyArray<{ openedAt: string | null }>;
}) {
  const t = useTranslations("drinkDetail");
  return (
    <Sheet open={open} onClose={onClose} title={t("title")} description={title}>
      {/* Drawn only while open, and from this year each time it opens. */}
      {open && <DrinkBody vintageId={vintageId} drink={drink} year={year} opened={opened} />}
    </Sheet>
  );
}

function DrinkBody({
  vintageId,
  drink,
  year,
  opened,
}: {
  vintageId: string;
  drink: DrinkSummary;
  year: number | null;
  opened: ReadonlyArray<{ openedAt: string | null }>;
}) {
  const t = useTranslations("drinkDetail");
  const tDrink = useTranslations("drink");
  const insight = useInsight(vintageId);
  const range = chartYearRange(drink, year);
  const [selected, setSelected] = useState<number | null>(() =>
    range ? Math.min(range.last, Math.max(range.first, range.thisYear)) : null,
  );
  const aging = insight.data?.ready ? (insight.data.insight?.output.aging ?? "") : "";
  const estimateNote = (
    <p className="text-caption text-ink-2" data-testid="drink-detail-basis-note">
      {drink.source === "own"
        ? t("ownNote")
        : tDrink(drink.source === "ai" ? "estimateAi" : "estimate")}
    </p>
  );

  // No window to explore (non-vintage), or only a rough one that put it late: say so, draw nothing.
  if (
    !range ||
    selected === null ||
    drink.from === null ||
    drink.until === null ||
    drink.uncertain
  ) {
    return (
      <div className="flex flex-col gap-3 pb-2" data-testid="drink-detail">
        <p className="text-body text-ink">
          {drink.uncertain ? tDrink("explainUncertain") : tDrink("explain.unknown")}
        </p>
        {drink.uncertain && estimateNote}
      </div>
    );
  }

  const { from, until } = drink;
  const stretches = windowStretches(from, until);
  const bestFrom = Math.round(stretches.best[0]);
  const bestUntil = Math.round(stretches.best[1]);
  const phase = phaseForYear(drink, selected) ?? "unknown";
  const meaning =
    phase === "young"
      ? t("yearYoung", { year: selected, from })
      : phase === "developing"
        ? t("yearDeveloping", { year: selected, bestFrom, bestUntil })
        : phase === "peak"
          ? t("yearPeak", { year: selected, bestFrom, bestUntil })
          : phase === "ready"
            ? t("yearReady", { year: selected, until })
            : t("yearPast", { year: selected, until });
  const step = (by: number) =>
    setSelected((y) => Math.min(range.last, Math.max(range.first, (y ?? range.thisYear) + by)));

  return (
    <div className="flex flex-col gap-6 pb-2" data-testid="drink-detail">
      {/* The window and where it stands today */}
      <div className="flex flex-col gap-3">
        <div>
          <p className={EYEBROW}>{t("windowLabel")}</p>
          <p
            className="font-display text-display leading-none text-ink tnum"
            data-testid="drink-detail-window"
          >
            {tDrink("window", { from, until })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="drink-detail-basis"
            className="rounded-full border border-hairline px-2.5 py-0.5 text-caption font-medium text-bronze"
          >
            {tDrink(`basis.${drink.source}`)}
          </span>
          <span className="inline-flex items-center gap-2 text-small text-ink-2">
            {t("today")}
            <PhasePill phase={drink.phase} />
          </span>
        </div>
      </div>

      <div>
        <DrinkChart
          drink={drink}
          year={year}
          opened={opened}
          size="large"
          explore={{ selected, onSelect: setSelected, label: t("chooseYear") }}
        />
        <p className="mt-2 text-caption text-ink-3">{t("hint")}</p>
      </div>

      {/* The chosen year: another way to choose it (buttons), and what it means for this wine */}
      <section
        aria-live="polite"
        aria-atomic="true"
        data-testid="drink-year"
        className="flex flex-col gap-3"
      >
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={selected <= range.first}
            aria-label={t("prevYear")}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-raised text-ink transition-transform duration-150 ease-cellr active:scale-95 disabled:opacity-35"
          >
            <ChevronRightIcon size={20} className="rotate-180" />
          </button>
          <div className="flex min-w-0 flex-col items-center gap-1 text-center">
            <p
              className="font-display text-headline leading-none text-ink tnum"
              data-testid="drink-year-value"
            >
              {selected}
              {selected === range.thisYear && (
                <span className="ml-2 align-middle text-caption font-medium text-accent-fg">
                  {t("thisYear")}
                </span>
              )}
            </p>
            <PhasePill phase={phase} />
          </div>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={selected >= range.last}
            aria-label={t("nextYear")}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-raised text-ink transition-transform duration-150 ease-cellr active:scale-95 disabled:opacity-35"
          >
            <ChevronRightIcon size={20} />
          </button>
        </div>
        <p
          className="font-display text-title italic text-balance text-ink"
          data-testid="drink-year-meaning"
        >
          {meaning}
        </p>
      </section>

      {/* What the window is, and what it cannot know */}
      <section className="flex flex-col gap-2 border-t border-hairline pt-5">
        <h3 className={EYEBROW}>{t("aboutTitle")}</h3>
        <p className="text-body text-ink">{t("about")}</p>
        <p className="text-body text-ink">{t("storage")}</p>
        {estimateNote}
      </section>

      {aging && (
        <section className="flex flex-col gap-1.5" data-testid="drink-detail-aging">
          <h3 className={EYEBROW}>{t("agingTitle")}</h3>
          <p className="text-body text-ink">{aging}</p>
          <p className="text-caption text-ink-2">{t("agingNote")}</p>
        </section>
      )}
    </div>
  );
}
