"use client";

import { useTranslations } from "next-intl";
import type { DrinkSummary } from "@cellr/domain";
import { cn } from "@/ui/cn";
import { PHASE_COLOUR } from "./phase-colour";

export { PHASE_COLOUR };

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

/** A slim bar for tiles: the window on one shared timeline (4 years back … 20 ahead), a tick for today. */
export function DrinkWindowMini({ drink, className }: { drink: DrinkSummary; className?: string }) {
  if (drink.from === null || drink.until === null) return null;
  const start = new Date().getFullYear() - 4;
  const span = 24;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const left = clamp((drink.from - start) / span);
  const right = clamp((drink.until + 1 - start) / span);
  return (
    <div className={cn("relative h-1 rounded-full bg-ink/10", className)} aria-hidden="true">
      <span
        className="absolute inset-y-0 rounded-full"
        style={{
          left: `${left * 100}%`,
          width: `${Math.max(right - left, 0.04) * 100}%`,
          background: PHASE_COLOUR[drink.phase],
        }}
      />
      <span
        className="absolute -top-[3px] h-2.5 w-0.5 rounded-full bg-ink"
        style={{ left: `${(4 / span) * 100}%` }}
      />
    </div>
  );
}
