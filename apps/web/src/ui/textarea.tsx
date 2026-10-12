"use client";

import { useId, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  error?: string | null | undefined;
  hideLabel?: boolean;
}

/** A labelled multi-line field: same look and the same promises as `Field`. */
export function Textarea({ label, error, hideLabel, className, ...rest }: TextareaProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className={cn("text-small font-medium text-ink-2", hideLabel && "sr-only")}
      >
        {label}
      </label>
      <textarea
        id={id}
        rows={4}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "min-h-28 w-full resize-y rounded-control border bg-surface px-4 py-3 text-body text-ink placeholder:text-ink-3",
          "transition-colors duration-150 ease-cellr focus-visible:border-accent-fg focus-visible:outline-none",
          error ? "border-danger" : "border-hairline",
          className,
        )}
        {...rest}
      />
      {error && (
        <p id={errorId} role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
