"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/ui/cn";

/**
 * Filters (or any secondary controls) that a phone folds away behind one button with the number of active ones, and
 * that a wide screen always shows. The fields stay in the page's own <form> (it is the same DOM, only hidden), so
 * submitting works the same folded or not.
 */
export function PhoneDisclosure({
  label = "Filters",
  active = 0,
  children,
  className,
  testId,
}: {
  label?: string;
  /** How many of the hidden controls are set: shown on the button. */
  active?: number;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className} data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex min-h-11 w-full items-center gap-2 rounded-[12px] px-3 text-small font-medium text-ink ring-1 ring-ink-3/50 hover:bg-raised md:hidden"
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        {label}
        {active > 0 && (
          <span className="rounded-full bg-accent px-2 text-caption font-semibold text-accent-ink tnum">
            {active}
          </span>
        )}
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={cn("ml-auto transition-transform", open && "rotate-180")}
        />
      </button>
      <div id={id} className={cn(!open && "max-md:hidden", "max-md:mt-3")}>
        {children}
      </div>
    </div>
  );
}
