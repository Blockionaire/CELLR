"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/ui/cn";

/** The card every block on the wine's page sits on. */
export const CARD = "rounded-card bg-surface p-4 shadow-raised ring-1 ring-hairline";

/** A calm block of the wine's page: a serif title (with an optional small action beside it) over one card. */
export function Section({
  title,
  action,
  testId,
  className,
  children,
}: {
  title?: string;
  /** Sits at the right end of the title row (a badge, a small button). */
  action?: ReactNode;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      data-testid={testId}
      className={className}
    >
      {title && (
        <div className="mb-3 flex min-h-9 items-center justify-between gap-3 px-1">
          <h2 id={headingId} className="font-display text-headline text-ink">
            {title}
          </h2>
          {action}
        </div>
      )}
      <div className={CARD}>{children}</div>
    </section>
  );
}

/** Label and value pairs, one per line, with a hairline between. */
export function Facts({ rows }: { rows: ReadonlyArray<readonly [string, string]> }) {
  return (
    <dl className="flex flex-col divide-y divide-hairline">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
        >
          <dt className="text-small text-ink-2">{label}</dt>
          <dd className="text-right text-body text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Small caps label used above a value inside a card. */
export const EYEBROW = "text-caption font-medium uppercase tracking-[0.14em] text-bronze";

/**
 * A pill-shaped tag for a grape, a pairing or a place. Put inside a `<ul>`; give it `last` for the final one so
 * that the list also reads as "Merlot, Cabernet Franc" to a screen reader.
 */
export function Tag({
  children,
  last = false,
  className,
}: {
  children: ReactNode;
  last?: boolean;
  className?: string;
}) {
  return (
    <li className={cn("rounded-full bg-raised px-3 py-1 text-small text-ink-2", className)}>
      {children}
      {!last && <span className="sr-only">, </span>}
    </li>
  );
}
