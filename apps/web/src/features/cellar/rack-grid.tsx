"use client";

import { useTranslations } from "next-intl";
import { formatVintage, type PlacedBottle } from "@cellr/domain";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { cn } from "@/ui/cn";
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
  className?: string;
}

const CELL = "h-14 w-11";

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
  className,
}: RackGridProps) {
  const t = useTranslations("rack");
  const bySpot = new Map<string, PlacedBottle>();
  for (const b of bottles) if (b.row !== null && b.col !== null) bySpot.set(`${b.row}:${b.col}`, b);

  return (
    <div className={cn("overflow-x-auto pb-2", className)}>
      <div
        className="inline-grid gap-x-1.5 gap-y-0 pr-2"
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
              if (bottle) {
                const active = bottle.bottleId === activeBottleId;
                const name = `${bottle.producer} ${bottle.wineName} ${formatVintage(bottle.year)}`;
                const label = t("cellBottle", { wine: name, row, col });
                const glyph = (
                  <BottleGlyph
                    shape={shapeFor(bottle.type)}
                    tint={bottle.type}
                    className="h-12 w-auto"
                  />
                );
                const base = cn(
                  CELL,
                  "grid place-items-center rounded-control",
                  active && "bg-raised ring-2 ring-accent-fg",
                );
                return onBottle ? (
                  <button
                    key={c}
                    type="button"
                    aria-label={label}
                    aria-pressed={activeBottleId ? active : undefined}
                    title={name}
                    onClick={() => onBottle(bottle)}
                    className={cn(
                      base,
                      "transition-transform duration-150 hover:bg-raised active:scale-95",
                    )}
                  >
                    {glyph}
                  </button>
                ) : (
                  <span key={c} role="img" aria-label={label} title={name} className={base}>
                    {glyph}
                  </span>
                );
              }
              const label = t("cellEmpty", { row, col });
              return onEmpty ? (
                <button
                  key={c}
                  type="button"
                  aria-label={label}
                  onClick={() => onEmpty(row, col)}
                  className={cn(
                    CELL,
                    "rounded-control border border-dashed border-hairline text-ink-3 transition-colors duration-150 hover:bg-raised hover:text-ink active:scale-95 active:bg-raised",
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
                  className={cn(
                    CELL,
                    "rounded-control border border-dashed border-hairline opacity-60",
                  )}
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
        className="mb-2 mt-1 h-[3px] rounded-full bg-hairline"
        style={{ gridColumn: `2 / span ${cols}` }}
      />
    </>
  );
}
