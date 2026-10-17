"use client";

import { useTranslations } from "next-intl";
import { formatVintage, type DrinkPhase, type WineType } from "@cellr/domain";
import { STAGE } from "@/features/cellar/wine-card";
import { labelMark, shapeFor } from "@/features/cellar/wine-visuals";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { cn } from "@/ui/cn";

/** Where a wine stands in its window, as a pill: tint from the maturity tokens, the word always says it too. */
const PILL: Record<Exclude<DrinkPhase, "unknown">, { pill: string; dot: string }> = {
  young: { pill: "bg-young-bg text-young-ink", dot: "bg-young" },
  developing: { pill: "bg-ready-bg text-ready-ink", dot: "bg-ready" },
  peak: { pill: "bg-peak-bg text-peak-ink", dot: "bg-peak" },
  ready: { pill: "bg-fading-bg text-fading-ink", dot: "bg-fading" },
  past: { pill: "bg-fading-bg text-fading-ink", dot: "bg-danger" },
};

/** "● At its best". Nothing for a wine with no window. */
export function PhasePill({ phase, className }: { phase: DrinkPhase; className?: string }) {
  const t = useTranslations("drink");
  if (phase === "unknown") return null;
  const look = PILL[phase];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-caption font-semibold",
        look.pill,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", look.dot)} />
      {t(`phase.${phase}`)}
    </span>
  );
}

/** A bottle standing on its tinted stage (decorative: the wine's name is always written next to it). */
export function WineStage({
  type,
  producer,
  wineName,
  year,
  className,
  bottleClassName,
}: {
  type: WineType;
  producer: string;
  wineName: string;
  year: number | null;
  className?: string;
  bottleClassName?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative flex items-end justify-center overflow-hidden rounded-[16px]",
        STAGE[type],
        className,
      )}
    >
      <span className="absolute -bottom-8 left-1/2 size-28 -translate-x-1/2 rounded-full bg-surface/45" />
      <BottleGlyph
        shape={shapeFor(type)}
        tint={type}
        mark={labelMark(producer, wineName)}
        year={formatVintage(year)}
        className={cn("relative mb-1.5", bottleClassName)}
      />
    </div>
  );
}
