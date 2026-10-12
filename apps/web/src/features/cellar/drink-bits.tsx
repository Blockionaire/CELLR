"use client";

import { useTranslations } from "next-intl";
import type { DrinkPhase } from "@cellr/domain";
import type { DrinkSummary } from "@cellr/domain";
import { cn } from "@/ui/cn";

/** Decorative only: the words always say the same thing, in text. */
export const PHASE_COLOUR: Record<DrinkPhase, string> = {
  young: "#4b8fd6",
  developing: "#54a86b",
  peak: "#c9a227",
  ready: "#d97b2b",
  past: "#a04747",
  unknown: "#8a8377",
};

/** "● At its best": where a wine stands in its window, in a few words. Nothing for a wine with no window. */
export function DrinkLabel({ drink, className }: { drink: DrinkSummary; className?: string }) {
  const t = useTranslations("drink");
  if (drink.phase === "unknown") return null;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1.5 text-caption text-ink-2", className)}
    >
      <span
        aria-hidden="true"
        className="size-2 rounded-full"
        style={{ background: PHASE_COLOUR[drink.phase] }}
      />
      {t(`phase.${drink.phase}`)}
    </span>
  );
}

/**
 * The drinking window as a bar: years at both ends, the three stretches (opening up, at its best, drink soon)
 * in their own tint, and a marker for today (pinned to the edge when the window has not opened, or has closed).
 */
export function DrinkWindowBar({ drink }: { drink: DrinkSummary }) {
  const t = useTranslations("drink");
  if (drink.from === null || drink.until === null || drink.position === null) return null;
  const position = Math.min(1, Math.max(0, drink.position));
  return (
    <div className="mt-5">
      <div className="relative h-3 rounded-full" aria-hidden="true">
        <div className="absolute inset-0 flex overflow-hidden rounded-full">
          <span
            className="h-full"
            style={{ width: "25%", background: PHASE_COLOUR.developing, opacity: 0.45 }}
          />
          <span
            className="h-full"
            style={{ width: "45%", background: PHASE_COLOUR.peak, opacity: 0.6 }}
          />
          <span
            className="h-full"
            style={{ width: "30%", background: PHASE_COLOUR.ready, opacity: 0.5 }}
          />
        </div>
        <span
          className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink shadow-raised"
          style={{ left: `${position * 100}%` }}
        />
      </div>
      <div className="mt-2 flex items-baseline justify-between text-small text-ink-2 tnum">
        <span>{drink.from}</span>
        <span className="text-caption">{t("today")}</span>
        <span>{drink.until}</span>
      </div>
    </div>
  );
}
