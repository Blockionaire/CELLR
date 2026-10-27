"use client";

import { useEffect, useRef } from "react";
import { scoreOfStars, starsOf } from "@cellr/domain";
import { cn } from "./cn";
import { StarIcon } from "./icons";

/** Five stars, filled to `score` (1..10 = half stars). Read-only; says its value to screen readers. */
export function Stars({
  score,
  size = 16,
  label,
  className,
}: {
  score: number;
  size?: number;
  /** Spoken: "Rated 4.5 out of 5". */
  label: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("inline-flex gap-0.5 text-accent-fg", className)}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(2, score - i * 2)) / 2; // 0, 0.5 or 1
        return (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <StarIcon size={size} className="absolute inset-0 text-ink-3" />
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${fill * 100}%` }}
              aria-hidden="true"
            >
              <StarIcon size={size} fill="currentColor" style={{ minWidth: size }} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

interface StarsInputProps {
  /** 1..10 (half-star score; tenths of a star allowed, e.g. 8.4 = 4.2 stars), or null for "not rated". */
  value: number | null;
  /** Every change, also while dragging (so the stars and number follow the finger). */
  onChange: (next: number | null) => void;
  /** The final value: once per release or tap ("pointer"), or on every key press ("key"). Save here, not in onChange. */
  onCommit?: (next: number | null, via: "pointer" | "key") => void;
  /** The control's name: "Your rating". */
  label: string;
  /** Spoken value: (score) → "4.2 stars". */
  optionLabel: (score: number) => string;
  /** Spoken when there is no rating yet: "Not rated". */
  emptyLabel: string;
  size?: number;
}

const GAP = 4; // gap-1

/**
 * Pick a rating to a tenth of a star (1.0–5.0): slide a finger (or the mouse) across the stars, or tap one. The
 * stars fill as you go and the number beside them says exactly where you are; the value is committed on release.
 * A slider for assistive tech: arrow keys move a tenth, Page Up/Down half a star, Home/End the ends, Delete
 * clears. Horizontal drags are ours (touch-action: pan-y), so the page neither scrolls sideways nor swipes back,
 * while vertical scrolling still works. Tapping exactly the current value clears it, as before.
 */
export function StarsInput({
  value,
  onChange,
  onCommit,
  label,
  optionLabel,
  emptyLabel,
  size = 40,
}: StarsInputProps) {
  const row = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; moved: boolean; from: number | null } | null>(null);
  // The value as last sent out, not as last rendered: a second tap that lands before React re-renders must still
  // see the first one (that is how "tap the same value again to clear" works on a quick double tap).
  const last = useRef(value);
  useEffect(() => {
    last.current = value;
  }, [value]);
  const emit = (next: number | null) => {
    last.current = next;
    onChange(next);
  };

  /** The score under a point: across the stars, gaps included, snapped to a tenth of a star, at least 1.0. */
  const scoreAt = (clientX: number): number => {
    const box = row.current?.getBoundingClientRect();
    const x = box ? clientX - box.left : 0;
    const unit = size + GAP;
    const i = Math.max(0, Math.floor(x / unit));
    const stars = Math.min(5, i + Math.min(1, Math.max(0, (x - i * unit) / size)));
    return scoreOfStars(Math.max(1, Math.round(stars * 10) / 10));
  };
  const set = (next: number | null, via: "pointer" | "key") => {
    emit(next);
    onCommit?.(next, via);
  };

  const stars = value === null ? null : starsOf(value);
  const step = (by: number) => {
    const from = last.current === null ? 0 : starsOf(last.current);
    set(scoreOfStars(Math.min(5, Math.max(1, Math.round((from + by) * 10) / 10))), "key");
  };

  return (
    <div className="inline-flex items-center gap-3">
      <div
        ref={row}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={stars ?? 0}
        aria-valuetext={value === null ? emptyLabel : optionLabel(value)}
        data-testid="stars-input"
        className="relative inline-flex cursor-pointer select-none gap-1 rounded-control text-accent-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-fg"
        style={{ touchAction: "pan-y", WebkitUserSelect: "none" }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, x: e.clientX, moved: false, from: last.current };
          emit(scoreAt(e.clientX));
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          if (Math.abs(e.clientX - d.x) > 4) d.moved = true;
          emit(scoreAt(e.clientX));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          drag.current = null;
          const final = scoreAt(e.clientX);
          set(!d.moved && d.from === final ? null : final, "pointer");
        }}
        onPointerCancel={() => {
          // The browser took the gesture (a vertical scroll): back to what it was, nothing saved.
          if (drag.current) emit(drag.current.from);
          drag.current = null;
        }}
        onKeyDown={(e) => {
          const moves: Record<string, number> = {
            ArrowRight: 0.1,
            ArrowUp: 0.1,
            ArrowLeft: -0.1,
            ArrowDown: -0.1,
            PageUp: 0.5,
            PageDown: -0.5,
          };
          if (e.key in moves) step(moves[e.key]!);
          else if (e.key === "Home") set(scoreOfStars(1), "key");
          else if (e.key === "End") set(scoreOfStars(5), "key");
          else if (e.key === "Delete" || e.key === "Backspace") set(null, "key");
          else return;
          e.preventDefault();
        }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <StarIcon size={size} className="absolute inset-0 text-ink-3" />
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${Math.max(0, Math.min(1, (stars ?? 0) - i)) * 100}%` }}
              aria-hidden="true"
            >
              <StarIcon size={size} fill="currentColor" style={{ minWidth: size }} />
            </span>
          </span>
        ))}
      </div>
      <span className="min-w-[3.5rem] text-body text-ink tnum" aria-hidden="true">
        {stars === null ? "– / 5" : `${stars.toFixed(1)} / 5`}
      </span>
    </div>
  );
}
