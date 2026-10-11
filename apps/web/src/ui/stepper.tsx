"use client";

import { cn } from "./cn";
import { MinusIcon, PlusIcon } from "./icons";

interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Accessible name, e.g. "Number of bottles". */
  label: string;
  className?: string;
}

/** HOW MANY? — big, thumb-sized, one hand. */
export function Stepper({ value, onChange, min = 1, max = 99, label, className }: StepperProps) {
  const step =
    "grid size-14 place-items-center rounded-card bg-raised text-ink transition-transform duration-150 active:scale-95 disabled:opacity-35";
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex items-center gap-5", className)}
    >
      <button
        type="button"
        className={step}
        aria-label="One fewer"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        <MinusIcon />
      </button>
      <output aria-live="polite" className="min-w-12 text-center font-display text-display tnum">
        {value}
      </output>
      <button
        type="button"
        className={step}
        aria-label="One more"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        <PlusIcon />
      </button>
    </div>
  );
}
