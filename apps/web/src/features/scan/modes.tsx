"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useId, useRef, type KeyboardEvent } from "react";
import { cn } from "@/ui/cn";
import { spring } from "@/ui/motion";

/**
 * The three ways to scan, chosen before the photo:
 * - "single": one wine, one bottle by default;
 * - "same": one label read once, then as many bottles of it as there are (quantity, not more photos);
 * - "batch": a photo per wine, different wines, each read and reviewed on its own.
 */
export const SCAN_MODES = ["single", "same", "batch"] as const;
export type ScanMode = (typeof SCAN_MODES)[number];

/** A clear, thumb-sized mode bar with one line saying what the chosen mode does. Arrow keys move. */
export function ModeBar({ value, onChange }: { value: ScanMode; onChange: (m: ScanMode) => void }) {
  const t = useTranslations("scan.modes");
  const id = useId();
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
    const next = (index + step + SCAN_MODES.length) % SCAN_MODES.length;
    onChange(SCAN_MODES[next]!);
    refs.current[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="radiogroup"
        aria-label={t("label")}
        aria-describedby={`${id}-hint`}
        className="grid grid-cols-3 gap-1 rounded-[20px] bg-raised p-1 ring-1 ring-hairline"
      >
        {SCAN_MODES.map((mode, index) => {
          const selected = mode === value;
          return (
            <button
              key={mode}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              data-mode={mode}
              onClick={() => onChange(mode)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={cn(
                "relative flex min-h-12 items-center justify-center gap-1.5 rounded-[16px] px-1.5 text-small font-medium transition-colors duration-150",
                selected ? "text-ink" : "text-ink-2 hover:text-ink",
              )}
            >
              {selected && (
                <motion.span
                  layoutId={`${id}-pill`}
                  transition={spring.snap}
                  className="absolute inset-0 rounded-[16px] bg-surface shadow-raised ring-1 ring-accent-fg/70"
                />
              )}
              <span aria-hidden="true" className={cn("relative", selected && "text-accent-fg")}>
                <ModeIcon mode={mode} />
              </span>
              <span className="relative leading-tight">{t(mode)}</span>
            </button>
          );
        })}
      </div>
      <p id={`${id}-hint`} className="px-1 text-caption text-ink-2" aria-live="polite">
        {t(`${value}Hint`)}
      </p>
    </div>
  );
}

function ModeIcon({ mode }: { mode: ScanMode }) {
  const bottle = (x: number) => (
    <path
      d={`M${x + 2} 3h2v4c1.6.8 2.5 2.2 2.5 4v9a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-9c0-1.8.9-3.2 2.5-4z`}
    />
  );
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {mode === "single" && bottle(7)}
      {mode === "same" && (
        <>
          {bottle(2)}
          {bottle(12)}
        </>
      )}
      {mode === "batch" && (
        <>
          <rect x="7" y="3" width="13" height="15" rx="2.5" />
          <path d="M4 7v11.5A2.5 2.5 0 0 0 6.5 21H16" />
        </>
      )}
    </svg>
  );
}
