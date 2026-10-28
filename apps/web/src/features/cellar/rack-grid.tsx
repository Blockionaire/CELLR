"use client";

import { useTranslations } from "next-intl";
import type { PointerEvent as ReactPointerEvent } from "react";
import { formatVintage, type PlacedBottle } from "@cellr/domain";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { cn } from "@/ui/cn";
import { STAGE } from "./wine-card";
import { shapeFor } from "./wine-visuals";

interface RackGridProps {
  rows: number;
  cols: number;
  /** Bottles that have a spot in this unit. */
  bottles: readonly PlacedBottle[];
  /** The bottle being moved (its own spot is highlighted and cannot be chosen as a target). */
  activeBottleId?: string | undefined;
  /** Tapping a free spot. Omit to make free spots inert. */
  onEmpty?: ((row: number, col: number) => void) | undefined;
  /** Tapping a bottle. Omit to make bottles inert. */
  onBottle?: ((bottle: PlacedBottle) => void) | undefined;
  /** While a bottle is on its way (`activeBottleId`), the other bottles are places to swap with (tapping one swaps). */
  swapTargets?: boolean;
  /** Names every spot (`data-slot="key|row|col"`), so a bottle dragged across several places can find where it is. */
  slotKey?: string;
  /** Pressing a bottle: where a long press to drag it begins. */
  onBottlePointerDown?:
    ((event: ReactPointerEvent<HTMLElement>, bottle: PlacedBottle) => void) | undefined;
  /** A bottle being dragged: its own spot, and the spot under the finger ("row:col" in this grid), while it moves and
   * while the move is being saved. */
  drag?: { sourceId: string | null; overKey: string | null; saving?: boolean } | undefined;
  className?: string;
}

/** Two arrows passing: "these two trade places". */
export function SwapGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M7 4 3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8" />
    </svg>
  );
}

/** 44px round slots: a comfortable thumb target, a bottle standing in each full one. */
const CELL = "size-11 rounded-full";

/**
 * A storage unit seen from the front: shelves top to bottom, positions left to right, each bottle
 * standing in its spot. One component serves "pick a spot to move to" and "browse my racks".
 */
export function RackGrid({
  rows,
  cols,
  bottles,
  activeBottleId,
  onEmpty,
  onBottle,
  swapTargets = false,
  slotKey,
  onBottlePointerDown,
  drag,
  className,
}: RackGridProps) {
  const t = useTranslations("rack");
  const tr = useTranslations("racks");
  // a bottle is on its way (tapped Move, or dragged): free spots are where it can land
  const targeting = activeBottleId !== undefined || (drag !== undefined && drag.sourceId !== null);
  const slot = (row: number, col: number) => (slotKey ? `${slotKey}|${row}|${col}` : undefined);
  const bySpot = new Map<string, PlacedBottle>();
  for (const b of bottles) if (b.row !== null && b.col !== null) bySpot.set(`${b.row}:${b.col}`, b);

  return (
    <div className={cn("overflow-x-auto px-1 pb-2", className)}>
      <div
        className="inline-grid justify-items-center gap-x-1.5 gap-y-0 pr-2"
        style={{ gridTemplateColumns: `1.5rem repeat(${cols}, 2.75rem)` }}
      >
        <span aria-hidden="true" />
        {Array.from({ length: cols }, (_, c) => (
          <span
            key={c}
            aria-hidden="true"
            className="pb-1 text-center text-caption text-ink-3 tnum"
          >
            {c + 1}
          </span>
        ))}

        {Array.from({ length: rows }, (_, r) => (
          <Shelf key={r} row={r + 1} cols={cols}>
            {Array.from({ length: cols }, (_, c) => {
              const row = r + 1;
              const col = c + 1;
              const bottle = bySpot.get(`${row}:${col}`);
              const key = `${row}:${col}`;
              const over = drag?.overKey === key;
              if (bottle) {
                const active = bottle.bottleId === activeBottleId;
                const source = drag?.sourceId === bottle.bottleId;
                // dragged onto, or (tapped Move) offered as a bottle to trade places with
                const swapInto = over && !source;
                const swappable = swapTargets && targeting && !active;
                const name = `${bottle.producer} ${bottle.wineName} ${formatVintage(bottle.year)}`;
                const label = swappable
                  ? tr("cellSwap", { wine: name, row, col })
                  : t("cellBottle", { wine: name, row, col });
                const glyph = (
                  <BottleGlyph
                    shape={shapeFor(bottle.type)}
                    tint={bottle.type}
                    className={cn(
                      "relative h-9 w-auto transition-opacity duration-150",
                      (source || swapInto) && "opacity-35",
                    )}
                  />
                );
                const base = cn(
                  CELL,
                  "relative grid place-items-center",
                  STAGE[bottle.type],
                  active
                    ? "ring-2 ring-accent-fg ring-offset-2 ring-offset-surface"
                    : swapInto
                      ? "z-10 scale-110 ring-2 ring-accent-fg ring-offset-2 ring-offset-surface"
                      : source
                        ? "outline-dashed outline-2 outline-offset-2 outline-accent-fg/70"
                        : swappable
                          ? "ring-1 ring-accent-fg/45"
                          : "ring-1 ring-hairline",
                  swapInto && drag?.saving && "animate-pulse",
                );
                // "these two trade places": over the bottle that would make way
                const badge = swapInto && (
                  <span
                    aria-hidden="true"
                    className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-accent text-accent-ink shadow-raised"
                  >
                    <SwapGlyph size={12} />
                  </span>
                );
                return onBottle ? (
                  <button
                    key={c}
                    type="button"
                    aria-label={label}
                    aria-pressed={activeBottleId ? active : undefined}
                    title={name}
                    data-slot={slot(row, col)}
                    data-bottle-id={bottle.bottleId}
                    onClick={() => onBottle(bottle)}
                    onPointerDown={
                      onBottlePointerDown ? (e) => onBottlePointerDown(e, bottle) : undefined
                    }
                    // a long press drags the bottle: no callout, no text selection on it
                    onContextMenu={onBottlePointerDown ? (e) => e.preventDefault() : undefined}
                    className={cn(
                      base,
                      "transition-[transform,box-shadow,outline-color] duration-150 ease-cellr hover:brightness-95 active:scale-95 motion-reduce:transition-none",
                      onBottlePointerDown && "select-none [-webkit-touch-callout:none]",
                    )}
                  >
                    {glyph}
                    {badge}
                  </button>
                ) : (
                  <span
                    key={c}
                    role="img"
                    aria-label={label}
                    title={name}
                    data-slot={slot(row, col)}
                    data-bottle-id={bottle.bottleId}
                    className={base}
                  >
                    {glyph}
                    {badge}
                  </span>
                );
              }
              const label = t("cellEmpty", { row, col });
              return onEmpty ? (
                <button
                  key={c}
                  type="button"
                  aria-label={label}
                  data-slot={slot(row, col)}
                  onClick={() => onEmpty(row, col)}
                  className={cn(
                    CELL,
                    "grid place-items-center border border-dashed transition-[transform,background-color,color] duration-150 ease-cellr hover:bg-raised hover:text-ink active:scale-95 active:bg-raised motion-reduce:transition-none",
                    over
                      ? "z-10 scale-110 border-solid border-accent bg-accent text-accent-ink shadow-raised hover:bg-accent hover:text-accent-ink"
                      : targeting
                        ? "border-accent-fg bg-raised text-accent-fg"
                        : "border-ink-3/50 text-ink-3",
                    over && drag?.saving && "animate-pulse",
                  )}
                >
                  <span aria-hidden="true" className="text-title leading-none">
                    +
                  </span>
                </button>
              ) : (
                <span
                  key={c}
                  role="img"
                  aria-label={label}
                  data-slot={slot(row, col)}
                  className={cn(CELL, "block border border-dashed border-ink-3/40 opacity-60")}
                />
              );
            })}
          </Shelf>
        ))}
      </div>
    </div>
  );
}

/** One shelf: its number on the left, a board under the bottles. */
function Shelf({ row, cols, children }: { row: number; cols: number; children: React.ReactNode }) {
  return (
    <>
      <span aria-hidden="true" className="grid place-items-center text-caption text-ink-3 tnum">
        {row}
      </span>
      {children}
      <span
        aria-hidden="true"
        className="mb-2 mt-1.5 h-[3px] w-full rounded-full bg-hairline"
        style={{ gridColumn: `2 / span ${cols}` }}
      />
    </>
  );
}
