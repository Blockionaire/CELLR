"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { cn } from "@/ui/cn";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"] as const;

/**
 * Six dots and a number pad, like a banking app. Tap the digits (or type them on a keyboard); the sixth one
 * hands the PIN over. The dots are announced as "3 of 6 digits".
 */
export function PinPad({
  value,
  onChange,
  onComplete,
  label,
  error,
  disabled,
  attempt = 0,
  length = 6,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete: (pin: string) => void;
  /** What is asked: "Enter your PIN". */
  label: string;
  error?: string | null;
  disabled?: boolean;
  /** Bumped on each wrong try, so the dots shake again. */
  attempt?: number;
  length?: number;
}) {
  const t = useTranslations("pin");

  const press = (key: string) => {
    if (disabled) return;
    if (key === "back") return onChange(value.slice(0, -1));
    if (value.length >= length) return;
    const next = value + key;
    onChange(next);
    if (next.length === length) onComplete(next);
  };

  // A keyboard works too (desktop, or a phone with a hardware keyboard).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("back");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex flex-col items-center gap-6" role="group" aria-label={label}>
      <div
        key={attempt}
        className={cn("flex gap-3.5", error && "motion-safe:animate-[shake_0.35s_ease-in-out]")}
        aria-live="polite"
        aria-label={t("progress", { count: value.length, total: length })}
        role="status"
        data-testid="pin-dots"
      >
        {Array.from({ length }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={cn(
              "size-3.5 rounded-full border-2 transition-colors duration-150",
              i < value.length ? "border-accent bg-accent" : "border-ink-3/60",
              error && "border-danger",
              error && i < value.length && "bg-danger",
            )}
          />
        ))}
      </div>
      {error && (
        <p role="alert" className="-mt-2 max-w-xs text-center text-small text-danger">
          {error}
        </p>
      )}
      <div className="grid grid-cols-3 gap-x-6 gap-y-3">
        {KEYS.map((key, i) =>
          key === "" ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              disabled={disabled || (key === "back" && value.length === 0)}
              onClick={() => press(key)}
              aria-label={key === "back" ? t("delete") : key}
              className={cn(
                "grid size-[4.5rem] place-items-center rounded-full font-display text-[1.75rem] text-ink transition-[transform,background-color] duration-100 ease-cellr active:scale-[0.94] disabled:opacity-40",
                key === "back"
                  ? "text-ink-2"
                  : "bg-surface shadow-raised ring-1 ring-hairline hover:bg-raised",
              )}
            >
              {key === "back" ? (
                <svg
                  width={26}
                  height={26}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" />
                  <path d="m17 9-6 6M11 9l6 6" />
                </svg>
              ) : (
                key
              )}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
