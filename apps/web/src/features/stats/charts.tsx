import type { ReactNode } from "react";

/** A short list of things with a count each, as bars: biggest first. The numbers are text, the bars decoration. */
export function BarList({
  label,
  rows,
  colour,
}: {
  label: string;
  rows: ReadonlyArray<{ key: string; label: ReactNode; count: number; colour?: string }>;
  colour?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {rows.map((r) => (
        <li
          key={r.key}
          className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-small"
        >
          <span className="truncate text-ink">{r.label}</span>
          <span aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-raised">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${(r.count / max) * 100}%`,
                background: r.colour ?? colour ?? "var(--accent)",
              }}
            />
          </span>
          <span className="tnum text-ink-2">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

/** Columns side by side (a year or a month each); optionally two heights per column (a part of the whole). */
export function Columns({
  label,
  columns,
  colour,
  partColour,
}: {
  label: string;
  columns: ReadonlyArray<{
    key: string;
    label: string;
    value: number;
    part?: number;
    text: string;
  }>;
  colour?: string;
  partColour?: string;
}) {
  const max = Math.max(1, ...columns.map((c) => c.value));
  return (
    <ol aria-label={label} className="flex h-36 items-end gap-1">
      {columns.map((c) => (
        <li
          key={c.key}
          className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
        >
          <span className="sr-only">{c.text}</span>
          <span
            aria-hidden="true"
            className="flex w-full flex-col justify-end overflow-hidden rounded-t-[3px]"
            style={{
              height: `${(c.value / max) * 100}%`,
              minHeight: c.value > 0 ? 3 : 0,
              background: `color-mix(in srgb, ${colour ?? "var(--accent)"} 55%, transparent)`,
            }}
          >
            {c.part !== undefined && c.part > 0 && (
              <span
                className="block w-full"
                style={{
                  height: `${(c.part / c.value) * 100}%`,
                  background: partColour ?? "#c9a227",
                }}
              />
            )}
          </span>
          <span aria-hidden="true" className="text-[10px] leading-none text-ink-3 tnum">
            {c.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
