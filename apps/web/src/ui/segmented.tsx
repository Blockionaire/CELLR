"use client";

import { motion } from "motion/react";
import { useId, useRef, type KeyboardEvent } from "react";
import { cn } from "./cn";
import { spring } from "./motion";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Shown instead of the word (which stays the accessible name). */
  icon?: React.ReactNode;
}

interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group, e.g. "Cellar view". */
  label: string;
  className?: string;
}

/** A radio group that looks like a toggle (Grid | List | 3D, Light | Dark | System). Arrow keys move. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedProps<T>) {
  const group = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    const option = options[next];
    if (option) {
      onChange(option.value);
      refs.current[next]?.focus();
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex rounded-full bg-raised p-1", className)}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.icon ? option.label : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "relative h-9 rounded-full text-small font-medium transition-colors duration-150",
              option.icon ? "grid w-9 place-items-center" : "min-w-16 px-4",
              selected ? "text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {selected && (
              <motion.span
                layoutId={`${group}-pill`}
                transition={spring.snap}
                className="absolute inset-0 rounded-full bg-surface shadow-raised"
              />
            )}
            {option.icon ? (
              <>
                <span aria-hidden="true" className="relative">
                  {option.icon}
                </span>
                <span className="sr-only">{option.label}</span>
              </>
            ) : (
              <span className="relative">{option.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
