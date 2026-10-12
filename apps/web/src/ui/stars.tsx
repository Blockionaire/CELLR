"use client";

import { useId } from "react";
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
  /** 1..10, or null for "not rated". */
  value: number | null;
  onChange: (next: number | null) => void;
  /** The group's name: "Your rating". */
  label: string;
  /** Spoken for each choice: (score) → "4½ stars". */
  optionLabel: (score: number) => string;
  size?: number;
}

/**
 * Pick a rating in half stars. Ten native radio buttons (so arrow keys, focus and screen readers just
 * work), each lying over the left or right half of a star. Tap the star you chose again to clear it.
 */
export function StarsInput({ value, onChange, label, optionLabel, size = 40 }: StarsInputProps) {
  const name = useId();
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      <div className="relative inline-flex gap-1 text-accent-fg">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
            <StarIcon size={size} className="absolute inset-0 text-ink-3" />
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${(Math.max(0, Math.min(2, (value ?? 0) - i * 2)) / 2) * 100}%` }}
              aria-hidden="true"
            >
              <StarIcon size={size} fill="currentColor" style={{ minWidth: size }} />
            </span>
            {[1, 2].map((half) => {
              const score = i * 2 + half;
              return (
                <label
                  key={half}
                  className={cn(
                    "absolute inset-y-0 cursor-pointer",
                    half === 1 ? "left-0 w-1/2" : "right-0 w-1/2",
                    "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-fg",
                  )}
                >
                  <span className="sr-only">{optionLabel(score)}</span>
                  <input
                    type="radio"
                    name={name}
                    value={score}
                    checked={value === score}
                    onChange={() => onChange(score)}
                    onClick={() => value === score && onChange(null)}
                    className="sr-only"
                  />
                </label>
              );
            })}
          </span>
        ))}
      </div>
    </fieldset>
  );
}
