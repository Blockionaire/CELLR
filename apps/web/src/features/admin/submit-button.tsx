"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * A form's submit button that says it is working while the server action runs (and cannot be pressed twice), so a
 * slow action on a phone never looks like a tap that did nothing.
 */
export function SubmitButton({
  children,
  pending,
  className,
  testId,
}: {
  children: ReactNode;
  /** What it says while the action runs. */
  pending: string;
  className?: string;
  testId?: string;
}) {
  const status = useFormStatus();
  return (
    <button
      type="submit"
      disabled={status.pending}
      aria-busy={status.pending || undefined}
      className={className}
      data-testid={testId}
    >
      {status.pending ? pending : children}
    </button>
  );
}
