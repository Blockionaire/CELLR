"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { CellarView, WineSummary, WineType } from "@cellr/domain";
import { api } from "@/lib/api";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { cn } from "@/ui/cn";
import { CheckIcon, ChevronRightIcon } from "@/ui/icons";
import { cellarKey } from "./hooks";
import { STAGE } from "./wine-card";
import { labelMark, shapeFor } from "./wine-visuals";

/** Stage and bottle sizes, tuned so the bottle always stands on the floor of its stage. */
const SIZES = {
  thumb: {
    box: "h-[4.5rem] w-14 rounded-[14px]",
    bottle: "w-[1.2rem]",
    disc: "-bottom-5 size-12",
  },
  card: {
    box: "h-28 w-24 rounded-[16px]",
    bottle: "mb-1.5 w-[1.9rem]",
    disc: "-bottom-8 size-[5.5rem]",
  },
  hero: {
    box: "h-56 w-full max-w-[16rem] rounded-[28px]",
    bottle: "mb-2 w-16",
    disc: "-bottom-16 size-48",
  },
} as const;

export type StageSize = keyof typeof SIZES;

/** A wine's bottle standing on its tinted stage: typeset from the producer, never a made-up label. */
export function WineStage({
  type,
  producer,
  name,
  year,
  size = "thumb",
  muted = false,
  className,
  bottleClassName,
}: {
  type: WineType;
  producer: string;
  name: string;
  year?: string | undefined;
  size?: StageSize;
  /** The kind of wine is not known yet: a neutral stage and a paler bottle. */
  muted?: boolean;
  className?: string;
  bottleClassName?: string;
}) {
  const s = SIZES[size];
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-end justify-center overflow-hidden",
        muted ? "bg-raised" : STAGE[type],
        s.box,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("absolute left-1/2 -translate-x-1/2 rounded-full bg-surface/45", s.disc)}
      />
      <BottleGlyph
        shape={shapeFor(type)}
        tint={type}
        mark={labelMark(producer, name)}
        year={year}
        className={cn("relative", s.bottle, muted && "opacity-60", bottleClassName)}
      />
    </span>
  );
}

/** "In your cellar ×3": a quiet pill for wines that already have bottles at home. */
export function OwnedPill({ count, className }: { count: number; className?: string }) {
  const t = useTranslations("addBottle");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-raised px-2.5 py-0.5 text-caption font-semibold text-ink-2 tnum",
        className,
      )}
    >
      {t("inCellar", { count })}
    </span>
  );
}

/**
 * Bottles per wine currently in the cellar (all vintages together), from the same cellar list the rest of
 * the app uses. Until it has loaded the map is empty, so no pill is shown rather than a wrong one.
 */
export function useOwnedCounts(): ReadonlyMap<string, number> {
  const cellar = useQuery({
    queryKey: cellarKey,
    queryFn: () => api.get<CellarView>("/cellar"),
  });
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of cellar.data?.items ?? [])
      counts.set(item.wineId, (counts.get(item.wineId) ?? 0) + item.count);
    return counts;
  }, [cellar.data]);
}

interface WineChoiceProps {
  wine: WineSummary;
  /** The line under the name: "2019 · Bordeaux, France". */
  detail?: string | undefined;
  /** Bottles of this wine already at home, when known. */
  owned?: number | undefined;
  /** The wine that is chosen right now: a ring and a check. */
  selected?: boolean;
  /** Without it the row is plain content (no button), for use inside another card. */
  onPick?: (() => void) | undefined;
  size?: StageSize;
}

/** One wine as a card: bottle on its stage, producer in bronze, the name in serif, and what we know of it. */
export function WineChoice({
  wine,
  detail,
  owned,
  selected = false,
  onPick,
  size = "thumb",
}: WineChoiceProps) {
  const body = (
    <>
      <WineStage type={wine.type} producer={wine.producer} name={wine.name} size={size} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption font-medium uppercase tracking-[0.14em] text-bronze">
          {wine.producer}
        </span>
        <span className="mt-0.5 block line-clamp-2 font-display text-title text-ink">
          {wine.name}
        </span>
        {detail && <span className="mt-0.5 block text-small text-ink-2">{detail}</span>}
        {owned ? <OwnedPill count={owned} className="mt-1.5" /> : null}
      </span>
      {onPick &&
        (selected ? (
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
            <CheckIcon size={16} />
          </span>
        ) : (
          <ChevronRightIcon size={20} className="shrink-0 text-ink-3" />
        ))}
    </>
  );

  if (!onPick) return <div className="flex items-center gap-4 text-left">{body}</div>;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3.5 rounded-card bg-surface p-3 text-left shadow-raised transition-transform duration-150 ease-cellr active:scale-[0.98]",
        selected ? "ring-2 ring-accent-fg" : "ring-1 ring-hairline",
      )}
    >
      {body}
    </button>
  );
}
