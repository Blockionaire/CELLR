import Link from "next/link";
import type { ReactNode } from "react";
import { ADMIN_RANGES, type AdminRange } from "@cellr/domain";
import { cn } from "@/ui/cn";

/** Small building blocks for the internal admin pages (server-rendered, no client state). */

export const usd = (micro: number | null | undefined) =>
  micro === null || micro === undefined
    ? "—"
    : `$${(micro / 1_000_000).toLocaleString("en-US", {
        minimumFractionDigits: micro < 10_000_000 ? 4 : 2,
        maximumFractionDigits: micro < 10_000_000 ? 4 : 2,
      })}`;

export const pct = (share: number | null | undefined) =>
  share === null || share === undefined ? "Unavailable" : `${(share * 100).toFixed(1)}%`;

export const num = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-US");

export const date = (iso: string | null | undefined) =>
  iso ? new Date(iso).toISOString().slice(0, 10) : "—";

export function PageTitle({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-headline text-ink">{title}</h1>
        {note && <p className="mt-1 max-w-3xl text-small text-ink-2">{note}</p>}
      </div>
      {children}
    </header>
  );
}

export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-body font-semibold text-ink">{title}</h2>
      {note && <p className="mt-0.5 text-caption text-ink-2">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Kpis({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{children}</div>;
}

export function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-[14px] border border-hairline bg-surface p-4">
      <p className="text-caption text-ink-2">{label}</p>
      <p className="mt-1 font-display text-display tnum text-ink">{value}</p>
      {hint && <p className="mt-1 text-caption text-ink-3">{hint}</p>}
    </div>
  );
}

export function Table({
  head,
  rows,
  empty = "Nothing in this period.",
}: {
  head: ReadonlyArray<{ label: string; numeric?: boolean }>;
  rows: ReadonlyArray<{ key: string; cells: ReadonlyArray<ReactNode> }>;
  empty?: string;
}) {
  if (rows.length === 0) return <p className="text-small text-ink-2">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-[14px] border border-hairline bg-surface">
      <table className="w-full min-w-[560px] text-small">
        <thead>
          <tr className="border-b border-hairline text-left text-caption text-ink-2">
            {head.map((h) => (
              <th key={h.label} className={cn("px-3 py-2 font-medium", h.numeric && "text-right")}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-hairline last:border-0">
              {r.cells.map((c, i) => (
                <td
                  key={i}
                  className={cn("px-3 py-2 text-ink", head[i]?.numeric && "text-right tnum")}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Vertical bars per day: values are text (title + caption), the bars decoration. */
export function DayBars({
  label,
  days,
  format = num,
}: {
  label: string;
  days: ReadonlyArray<{ day: string; value: number }>;
  format?: (n: number) => string;
}) {
  if (days.length === 0) return <p className="text-small text-ink-2">No data in this period.</p>;
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <figure className="rounded-[14px] border border-hairline bg-surface p-4">
      <ol aria-label={label} className="flex h-32 items-end gap-[2px]">
        {days.map((d) => (
          <li
            key={d.day}
            title={`${d.day}: ${format(d.value)}`}
            className="flex-1 rounded-t-[3px] bg-accent/80"
            style={{ height: `${Math.max(d.value > 0 ? 3 : 0, (d.value / max) * 100)}%` }}
          >
            <span className="sr-only">{`${d.day}: ${format(d.value)}`}</span>
          </li>
        ))}
      </ol>
      <figcaption className="mt-2 flex justify-between text-caption text-ink-3">
        <span>{days[0]?.day}</span>
        <span>peak {format(max === 1 && days.every((d) => d.value === 0) ? 0 : max)}</span>
        <span>{days.at(-1)?.day}</span>
      </figcaption>
    </figure>
  );
}

export function RangeTabs({ path, current }: { path: string; current: AdminRange }) {
  return (
    <nav aria-label="Period" className="flex gap-1 rounded-full bg-raised p-1 text-small">
      {ADMIN_RANGES.map((r) => (
        <Link
          key={r}
          href={`${path}?days=${r}`}
          aria-current={r === current ? "page" : undefined}
          className={cn(
            "rounded-full px-3 py-1",
            r === current ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2",
          )}
        >
          {r} days
        </Link>
      ))}
    </nav>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="mb-6 rounded-[14px] border border-hairline bg-raised p-4 text-small text-ink-2">
      {children}
    </p>
  );
}

export const NOT_READY =
  "The admin database step (supabase/migrations/20261026000018_admin_dashboard.sql) has not been run yet.";
export const NO_SERVICE_ROLE =
  "SUPABASE_SERVICE_ROLE_KEY is not configured on the server, so there is nothing to read.";

/** "missing" | null | value → a notice or the value. */
export function unavailable(value: unknown): string | null {
  return value === "missing" ? NOT_READY : value === null ? NO_SERVICE_ROLE : null;
}
