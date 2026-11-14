"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { ResolvedStorage } from "@cellr/domain";
import { cn } from "@/ui/cn";
import {
  MAP_LABELS_EN,
  cellLabel,
  chosenByPressing,
  chosenPlace,
  mapData,
  type MapBottle,
  type MapCell,
  type MapLabels,
} from "./layout-cells";

/**
 * A place seen flat, to read (Smart Cellar 3D, sprint 2A). Nothing can be moved here: placing, swapping and
 * dragging stay with the existing racks view until those know about an index.
 *
 * What it shows is what is known. A rack: each position, and behind it what lies behind. A place of bins: per
 * compartment how many, as a number and a bar, with no bottle drawn at any particular place in it. A place whose
 * arrangement is not known: the same count, and a line saying so.
 *
 * One tab stop; the arrow keys move from cell to cell; Enter or Space chooses the cell's FRONT bottle and no other.
 * A deep position whose front is free chooses nothing, even with a bottle behind it: what a press does is what the
 * picture shows and what the cell says. A bottle behind the front is chosen where it can be pointed at (the 3D view);
 * this picture then marks which place it is, in sight and in words. Cells are at least 44 px, and a wide place
 * scrolls sideways inside its own box.
 */
export interface LayoutMapProps {
  resolved: ResolvedStorage;
  bottles: readonly MapBottle[];
  selectedId?: string | null | undefined;
  onSelect?: ((id: string | null) => void) | undefined;
  /** The name of the place, for the picture's accessible name. */
  label: string;
  labels?: MapLabels | undefined;
  className?: string | undefined;
}

export function LayoutMap({
  resolved,
  bottles,
  selectedId = null,
  onSelect,
  label,
  labels = MAP_LABELS_EN,
  className,
}: LayoutMapProps) {
  const data = mapData(resolved, bottles);
  const [focus, setFocus] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const byKey = new Map(data.cells.map((c) => [`${c.row}:${c.col}`, c]));
  const first = data.cells[0];
  const current = focus && byKey.has(focus) ? focus : first ? `${first.row}:${first.col}` : null;

  const move = (event: KeyboardEvent, cell: MapCell) => {
    const step: Record<string, [number, number]> = {
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
    };
    const d = step[event.key];
    if (!d) return;
    event.preventDefault();
    // the next cell that exists in that direction (a place need not have one at every row and column)
    let [r, c] = [cell.row + d[0], cell.col + d[1]];
    while (r >= 1 && r <= data.rows && c >= 1 && c <= data.cols) {
      if (byKey.has(`${r}:${c}`)) {
        setFocus(`${r}:${c}`);
        refs.current.get(`${r}:${c}`)?.focus();
        return;
      }
      r += d[0];
      c += d[1];
    }
  };

  const wide = data.mode === "count";
  return (
    <figure
      className={cn("m-0 flex flex-col gap-3", className)}
      data-testid="layout-map"
      data-mode={data.mode}
    >
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-small text-ink-2">
        <span className="tnum" data-testid="layout-map-summary">
          {labels.summary(data.used, data.capacity)}
        </span>
        {!resolved.arrangementKnown ? (
          <span className="max-w-prose text-ink-2" data-testid="layout-map-unknown">
            {labels.unknownNote}
          </span>
        ) : data.mode === "count" ? (
          <span className="text-ink-3">{labels.countNote}</span>
        ) : data.mode === "depth" ? (
          <span className="text-ink-3">{labels.depthNote}</span>
        ) : null}
      </figcaption>
      <div
        role="grid"
        aria-label={label}
        aria-rowcount={data.rows}
        aria-colcount={data.cols}
        className="overflow-x-auto rounded-[16px] bg-raised/60 p-2"
      >
        <div
          className="grid w-max gap-1.5"
          style={{
            gridTemplateColumns: `1.5rem repeat(${data.cols}, ${wide ? "minmax(4.5rem, 1fr)" : "2.75rem"})`,
          }}
        >
          {Array.from({ length: data.rows }, (_, r) => (
            <div key={r} role="row" aria-rowindex={r + 1} className="contents">
              <span
                role="rowheader"
                className="grid place-items-center text-caption text-ink-3 tnum"
              >
                {r + 1}
              </span>
              {Array.from({ length: data.cols }, (_, c) => {
                const cell = byKey.get(`${r + 1}:${c + 1}`);
                if (!cell) return <span key={c} role="gridcell" aria-hidden="true" />;
                const key = `${cell.row}:${cell.col}`;
                const holdsSelected =
                  selectedId !== null && cell.bottles.some((b) => b.id === selectedId);
                const place = chosenPlace(cell, selectedId);
                // pressed means: the bottle this cell stands for (its front one) is the chosen one. A compartment
                // stands for none, so it is pressed when the chosen bottle is somewhere in it.
                const pressed = cell.mode === "count" ? holdsSelected : place === 1;
                return (
                  <div key={c} role="gridcell" aria-colindex={c + 1} className="grid">
                    <button
                      type="button"
                      ref={(el) => {
                        if (el) refs.current.set(key, el);
                        else refs.current.delete(key);
                      }}
                      tabIndex={key === current ? 0 : -1}
                      aria-label={cellLabel(cell, labels, selectedId)}
                      aria-pressed={onSelect ? pressed : undefined}
                      data-chosen-place={place ?? undefined}
                      data-cell={key}
                      data-used={cell.used}
                      data-capacity={cell.capacity}
                      onFocus={() => setFocus(key)}
                      onKeyDown={(e) => move(e, cell)}
                      onClick={() => onSelect?.(chosenByPressing(cell, selectedId))}
                      className={cn(
                        "relative min-h-11 min-w-11 text-left transition-[box-shadow,background-color] duration-150 ease-cellr",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fg",
                        cell.mode === "count"
                          ? "rounded-[12px] bg-surface p-2 ring-1 ring-hairline"
                          : "grid place-items-center rounded-[14px]",
                        holdsSelected && "ring-2 ring-accent-fg",
                      )}
                    >
                      {cell.mode === "count" ? (
                        <CountCell cell={cell} />
                      ) : (
                        <SpotCell cell={cell} chosen={place} />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {data.stranded.length > 0 && (
        <p role="status" className="text-small text-danger" data-testid="layout-map-stranded">
          {labels.stranded(data.stranded.length)}
        </p>
      )}
    </figure>
  );
}

/**
 * One position of a rack: the front bottle as a disc in its wine's colour, and a pip for every place behind it.
 * `chosen`: the place (1 = front) of the chosen bottle, which gets a ring of its own.
 */
function SpotCell({ cell, chosen }: { cell: MapCell; chosen: number | null }) {
  const slots = cell.slots!;
  const front = slots[0];
  return (
    <span aria-hidden="true" className="flex items-center gap-1">
      <span
        className={cn(
          "block size-8 rounded-full",
          front ? "ring-1 ring-hairline" : "border border-dashed border-ink-3/50",
          chosen === 1 && "outline-2 outline-offset-1 outline-accent-fg",
        )}
        style={front ? { backgroundColor: `var(--wine-${front.type})` } : undefined}
      />
      {slots.length > 1 && (
        <span className="flex flex-col gap-0.5" data-testid="depth-pips">
          {slots.slice(1).map((b, i) => (
            <span
              key={i}
              className={cn(
                "block size-2 rounded-full",
                b ? "" : "border border-ink-3/50",
                chosen === i + 2 && "outline-2 outline-offset-1 outline-accent-fg",
              )}
              style={b ? { backgroundColor: `var(--wine-${b.type})` } : undefined}
            />
          ))}
        </span>
      )}
    </span>
  );
}

/** A compartment: how many of how many, as a number and a bar. No bottle is drawn at a place in it. */
function CountCell({ cell }: { cell: MapCell }) {
  const share = cell.capacity > 0 ? cell.used / cell.capacity : 0;
  return (
    <span aria-hidden="true" className="flex flex-col gap-1.5">
      <span className="font-display text-body text-ink tnum">
        {cell.used}
        <span className="text-ink-3">/{cell.capacity}</span>
      </span>
      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-hairline">
        <span
          className="block h-full rounded-full bg-accent-fg"
          style={{ width: `${share * 100}%` }}
        />
      </span>
    </span>
  );
}
