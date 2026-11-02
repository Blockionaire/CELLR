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

// ---- Shared styles --------------------------------------------------------------------------------------------
// One place for the admin's controls, so contrast and states are the same on every page. Text links use accent-fg
// (the design system's colour for links and focus, ≥ 8.8:1 on every surface); accent-ink is only ever text ON an
// accent fill.

/** A text link. */
export const link =
  "font-medium text-accent-fg underline-offset-4 decoration-1 hover:underline focus-visible:underline";
/** A form control: a visible boundary (≥ 3:1), hover and focus. */
export const input =
  "rounded-[10px] bg-surface px-3 py-2 text-small text-ink ring-1 ring-ink-3/60 placeholder:text-ink-3 hover:ring-ink-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-fg disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-raised read-only:text-ink-2";
const pill =
  "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-small font-medium transition-[background-color,box-shadow,filter] duration-150 disabled:cursor-not-allowed disabled:opacity-50";
/** The page's main action. */
export const button = `${pill} bg-accent text-accent-ink hover:brightness-110 active:brightness-95`;
/** A secondary action. */
export const quiet = `${pill} text-ink ring-1 ring-ink-3/60 hover:bg-raised hover:ring-ink-2`;
/** An action that removes or undoes something: set apart, never the default look. */
export const danger = `${pill} text-danger ring-1 ring-danger/60 hover:bg-danger/10`;
/** A small secondary action inside a table row. */
export const small =
  "inline-flex items-center rounded-full px-3 py-1 text-caption font-medium text-ink ring-1 ring-ink-3/60 hover:bg-raised hover:ring-ink-2";
export const smallDanger =
  "inline-flex items-center rounded-full px-3 py-1 text-caption font-medium text-danger ring-1 ring-danger/60 hover:bg-danger/10";

export type Crumb = { label: string; href?: string };

/** Where this page sits: Admin › section › this page. */
export function Breadcrumbs({ items }: { items: ReadonlyArray<Crumb> }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2 text-caption text-ink-2">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((c, i) => (
          <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">›</span>}
            {c.href ? (
              <Link href={c.href} prefetch={false} className={cn(link, "font-normal")}>
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-ink">
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageTitle({
  title,
  note,
  crumbs,
  children,
}: {
  title: string;
  note?: string;
  /** Breadcrumbs above the title; "Admin" is added in front. */
  crumbs?: ReadonlyArray<Crumb>;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {crumbs && <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, ...crumbs]} />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-headline text-ink">{title}</h1>
          {note && <p className="mt-1 max-w-3xl text-small text-ink-2">{note}</p>}
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </header>
  );
}

const TAG_TONE = {
  "Read-only": "bg-raised text-ink-2",
  Editable: "bg-young-bg text-young-ink",
  "Shared catalogue": "bg-peak-bg text-peak-ink",
  "Household only": "bg-raised text-ink-2",
} as const;

export function Section({
  title,
  note,
  id,
  tag,
  children,
}: {
  title: string;
  note?: string;
  /** An anchor, to link to the section */
  id?: string;
  /** Whether the section only shows things, or changes them. */
  tag?: keyof typeof TAG_TONE;
  children: ReactNode;
}) {
  return (
    <section className="mb-10 scroll-mt-24" id={id} aria-label={title}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-title font-semibold text-ink">{title}</h2>
        {tag && (
          <span className={cn("rounded-full px-2 py-0.5 text-caption font-medium", TAG_TONE[tag])}>
            {tag}
          </span>
        )}
      </div>
      {note && <p className="mt-1 max-w-3xl text-small text-ink-2">{note}</p>}
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

export type Tone = "neutral" | "info" | "ok" | "warn" | "danger";
const PILL_TONE: Record<Tone, string> = {
  neutral: "bg-raised text-ink-2",
  info: "bg-young-bg text-young-ink",
  ok: "bg-ready-bg text-ready-ink",
  warn: "bg-peak-bg text-peak-ink",
  danger: "bg-fading-bg text-fading-ink",
};

/** A short status, always a word (never colour alone). */
export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-caption font-medium",
        PILL_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

export type SortState = { href: string; dir: "asc" | "desc" | null };
export type Column = { label: string; numeric?: boolean; sort?: SortState; className?: string };
export type Row = {
  key: string;
  cells: ReadonlyArray<ReactNode>;
  /** The whole row opens this page: the cell `linkCell` becomes the row's one link, stretched over the row. */
  href?: string;
  linkCell?: number;
  testId?: string;
};

/**
 * A data table. A row with `href` is one real link (on its primary cell), stretched over the whole row with CSS: the
 * row is clickable anywhere, keyboard users reach it with Tab and open it with Enter, and the other links and buttons
 * in the row stay their own, separate targets (no nested links, no row-level click handlers). Sortable columns are
 * links too, with aria-sort on the header.
 */
export function Table({
  head,
  rows,
  empty = "Nothing in this period.",
  caption,
  className,
}: {
  head: ReadonlyArray<Column>;
  rows: ReadonlyArray<Row>;
  empty?: ReactNode;
  caption?: string;
  className?: string;
}) {
  if (rows.length === 0)
    return typeof empty === "string" ? (
      <p className="rounded-[14px] border border-dashed border-hairline p-6 text-small text-ink-2">
        {empty}
      </p>
    ) : (
      <>{empty}</>
    );
  return (
    <div
      className={cn(
        // relative: positioned helpers inside (screen-reader text, the rows' stretched links) scroll with the table
        "relative overflow-x-auto rounded-[14px] border border-hairline bg-surface",
        className,
      )}
    >
      <table className="w-full min-w-[640px] border-collapse text-small">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-hairline text-left">
            {head.map((h) => (
              <th
                key={h.label}
                scope="col"
                aria-sort={
                  h.sort?.dir === "asc"
                    ? "ascending"
                    : h.sort?.dir === "desc"
                      ? "descending"
                      : undefined
                }
                className={cn(
                  "whitespace-nowrap px-3 py-2.5 text-caption font-semibold uppercase tracking-[0.06em] text-ink-2",
                  h.numeric && "text-right",
                  h.className,
                )}
              >
                {h.sort ? (
                  <Link
                    href={h.sort.href}
                    prefetch={false}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-[6px] hover:text-ink",
                      h.sort.dir && "text-ink",
                    )}
                  >
                    {h.label}
                    <span aria-hidden="true" className="text-[0.7rem]">
                      {h.sort.dir === "asc" ? "▲" : h.sort.dir === "desc" ? "▼" : "↕"}
                    </span>
                    <span className="sr-only">
                      {h.sort.dir === "asc"
                        ? ", sorted ascending; sort descending"
                        : h.sort.dir === "desc"
                          ? ", sorted descending; sort ascending"
                          : ", sort"}
                    </span>
                  </Link>
                ) : (
                  h.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const at = r.linkCell ?? 0;
            return (
              <tr
                key={r.key}
                data-testid={r.testId}
                data-href={r.href}
                className={cn(
                  "border-b border-hairline last:border-0",
                  r.href && [
                    "relative cursor-pointer transition-colors duration-100 hover:bg-raised",
                    "has-[a[data-row-link]:focus-visible]:bg-raised",
                    // the row's other controls sit above the stretched link
                    "[&_:is(a,button,input,select,textarea,label,summary):not([data-row-link])]:relative",
                    "[&_:is(a,button,input,select,textarea,label,summary):not([data-row-link])]:z-[1]",
                  ],
                )}
              >
                {r.cells.map((c, i) => (
                  <td
                    key={i}
                    className={cn(
                      "px-3 py-2.5 align-middle text-ink",
                      head[i]?.numeric && "text-right tnum",
                    )}
                  >
                    {r.href && i === at ? (
                      <Link
                        href={r.href}
                        prefetch={false}
                        data-row-link=""
                        className={cn(
                          "font-medium text-ink decoration-accent-fg underline-offset-4 hover:underline",
                          "after:absolute after:inset-0 after:rounded-[10px] after:content-['']",
                          "focus-visible:outline-none focus-visible:underline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-solid focus-visible:after:outline-accent-fg",
                        )}
                      >
                        {c}
                      </Link>
                    ) : (
                      c
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Previous · page x of y · next, keeping every other parameter of the URL. */
export function Pager({
  page,
  pages,
  href,
  label = "Pages",
}: {
  page: number;
  pages: number;
  href: (page: number) => string;
  label?: string;
}) {
  if (pages <= 1) return null;
  return (
    <nav aria-label={label} className="mt-4 flex items-center justify-between gap-3 text-small">
      {page > 1 ? (
        <Link href={href(page - 1)} prefetch={false} className={quiet} rel="prev">
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-ink-2 tnum">
        Page {num(page)} of {num(pages)}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} prefetch={false} className={quiet} rel="next">
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** One active filter, with a link that removes it. */
export function FilterChip({ label, remove }: { label: string; remove: string }) {
  return (
    <Link
      href={remove}
      prefetch={false}
      aria-label={`Remove filter: ${label}`}
      className="inline-flex items-center gap-1.5 rounded-full bg-raised px-3 py-1 text-caption font-medium text-ink ring-1 ring-ink-3/40 hover:ring-ink-2"
    >
      {label}
      <span aria-hidden="true" className="text-ink-2">
        ×
      </span>
    </Link>
  );
}

/** A tab of a filtered list: a link, marked as the current one. */
export function Tab({
  href,
  current,
  children,
  count,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
  count?: number;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={current ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-small font-medium ring-1",
        current
          ? "bg-ink text-canvas ring-ink"
          : "text-ink-2 ring-ink-3/50 hover:bg-raised hover:text-ink",
      )}
    >
      {children}
      {count !== undefined && (
        <span
          className={cn(
            "rounded-full px-1.5 text-caption tnum",
            current ? "bg-canvas/20 text-canvas" : "bg-raised text-ink-2",
          )}
        >
          {num(count)}
        </span>
      )}
    </Link>
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
            r === current
              ? "bg-surface font-medium text-ink shadow-sm"
              : "text-ink-2 hover:text-ink",
          )}
        >
          {r} days
        </Link>
      ))}
    </nav>
  );
}

const NOTICE_TONE: Record<Tone, string> = {
  neutral: "border-hairline bg-raised text-ink-2",
  info: "border-transparent bg-young-bg text-young-ink",
  ok: "border-transparent bg-ready-bg text-ready-ink",
  warn: "border-transparent bg-peak-bg text-peak-ink",
  danger: "border-transparent bg-fading-bg text-fading-ink",
};

export function Notice({
  children,
  tone = "neutral",
  className,
  testId,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : tone === "ok" ? "status" : undefined}
      data-testid={testId}
      data-tone={tone}
      className={cn("mb-6 rounded-[14px] border p-4 text-small", NOTICE_TONE[tone], className)}
    >
      {children}
    </div>
  );
}

/** Whether a page message (?msg=) reports something that did not happen. */
export const failed = (message: string) =>
  /^(not |nothing |choose |too |run )|not (saved|uploaded|published|changed|removed|linked)/i.test(
    message.trim(),
  );

/** The result of the last action, from ?msg=: a success, or what went wrong. */
export function Message({ text }: { text: string | null }) {
  if (!text) return null;
  const bad = failed(text);
  return (
    <Notice tone={bad ? "danger" : "ok"} testId="action-message">
      <span className="font-semibold">{bad ? "Not done. " : "Done. "}</span>
      {text}
    </Notice>
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
