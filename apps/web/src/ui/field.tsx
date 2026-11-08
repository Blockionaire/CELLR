"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: ReactNode;
  /** Human error text. Announced to screen readers when it appears. */
  error?: string | null | undefined;
  /** Visually hide the label (it stays for assistive tech). */
  hideLabel?: boolean;
  inputClassName?: string;
}

const DATE_TYPES = new Set(["date", "time", "datetime-local", "month", "week"]);

/** A labelled text input. The label is always real (never placeholder-only). */
export function Field({
  label,
  hint,
  error,
  hideLabel,
  className,
  inputClassName,
  ...rest
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  // iOS Safari draws date and time fields as a native control with a width of its own, wider than `w-full` allows:
  // without its native appearance it is an ordinary box that takes the column's width like every other field (the
  // native picker still opens on tap). Its value is centred by default; start it where every other field's text does.
  const dateLike = DATE_TYPES.has(String(rest.type ?? ""));

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={id}
        className={cn("text-small font-medium text-ink-2", hideLabel && "sr-only")}
      >
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          // min-w-0: a control never claims more width than its column (WebKit gives date fields an intrinsic one)
          "h-12 w-full min-w-0 rounded-control border bg-surface px-4 text-body text-ink placeholder:text-ink-3",
          "transition-colors duration-150 ease-cellr focus-visible:border-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-fg/30",
          error ? "border-danger" : "border-hairline",
          dateLike && "block appearance-none text-left [&::-webkit-date-and-time-value]:text-left",
          inputClassName,
        )}
        {...rest}
      />
      {hint && !error && (
        <p id={hintId} className="text-caption text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The 6-digit sign-in code: one field so iOS/Android can autofill it from the email. */
export function CodeField(
  props: Omit<FieldProps, "inputMode" | "autoComplete" | "maxLength" | "type">,
) {
  return (
    <Field
      {...props}
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={7}
      inputClassName={cn(
        "text-center font-medium tracking-[0.5em] text-headline tnum",
        props.inputClassName,
      )}
    />
  );
}
