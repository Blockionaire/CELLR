import Link from "next/link";
import type { ReactNode } from "react";
import type { WineType } from "@cellr/domain";
import { STAGE } from "@/features/cellar/wine-card";
import { labelMark, shapeFor } from "@/features/cellar/wine-visuals";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { cn } from "@/ui/cn";

/**
 * The colour of a kind of wine in a chart: the tint as it is on paper, and on noir lifted a little towards the ink so
 * the darkest reds still stand out from the card. Decorative: the legend always says it in words.
 */
export const wineFill = (type: string) =>
  `light-dark(var(--wine-${type}), color-mix(in oklab, var(--wine-${type}) 72%, var(--ink)))`;

/** The default bar: a soft-to-full sweep of the accent (burgundy on paper, brass on noir). */
const SWEEP =
  "linear-gradient(90deg, color-mix(in srgb, var(--accent) 45%, transparent), var(--accent))";

/**
 * A short list of things with a count each, as bars: biggest first. The numbers are text, the bars decoration.
 * `stacked` puts the label and the figure above a full-width bar (for amounts of money, where bars must line up).
 */
export function BarList({
  label,
  rows,
  colour,
  max: scale,
  stacked = false,
}: {
  label: string;
  rows: ReadonlyArray<{
    key: string;
    label: ReactNode;
    count: number;
    colour?: string;
    /** What to print instead of the count (an amount, say). */
    text?: string;
  }>;
  colour?: string;
  /** The value a full bar stands for, when it is not simply the biggest row (stars out of 5). */
  max?: number;
  stacked?: boolean;
}) {
  const max = Math.max(1, scale ?? 0, ...rows.map((r) => r.count));
  const bar = (r: (typeof rows)[number], className?: string) => (
    <span
      aria-hidden="true"
      className={cn("block h-2 overflow-hidden rounded-full bg-raised", className)}
    >
      <span
        className="block h-full rounded-full"
        style={{
          width: `${(r.count / max) * 100}%`,
          minWidth: r.count > 0 ? "0.5rem" : 0,
          background: r.colour ?? colour ?? SWEEP,
        }}
      />
    </span>
  );
  return (
    <ul aria-label={label} className={cn("flex flex-col", stacked ? "gap-4" : "gap-3")}>
      {rows.map((r) =>
        stacked ? (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-small text-ink-2">{r.label}</span>
              <span className="font-display text-title leading-none text-ink tnum">
                {r.text ?? r.count}
              </span>
            </div>
            {bar(r, "mt-2")}
          </li>
        ) : (
          <li
            key={r.key}
            className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)_2rem] items-center gap-3 text-small"
          >
            <span className="min-w-0 break-words text-ink">{r.label}</span>
            {bar(r)}
            <span className="text-right font-medium text-ink tnum">{r.text ?? r.count}</span>
          </li>
        ),
      )}
    </ul>
  );
}

/**
 * A ring split by share, with the total in the middle and a legend (swatch, name, count, share) beside it, so
 * colour is never the only way to read it. `label` names the legend list; `chartLabel` sums the ring up.
 */
export function Donut({
  label,
  chartLabel,
  unit,
  rows,
}: {
  label: string;
  chartLabel: string;
  /** What is being counted, under the total ("bottles"). */
  unit: string;
  rows: ReadonlyArray<{ key: string; label: string; count: number; colour: string }>;
}) {
  const total = rows.reduce((a, r) => a + r.count, 0);
  const R = 54;
  const C = 2 * Math.PI * R;
  const gap = rows.length > 1 ? 3 : 0;
  return (
    <div className="flex items-center gap-4">
      <div className="relative size-32 shrink-0">
        <svg viewBox="0 0 140 140" role="img" aria-label={chartLabel} className="size-full">
          <g transform="rotate(-90 70 70)">
            {rows.map((r, i) => {
              const before = rows.slice(0, i).reduce((a, x) => a + x.count, 0);
              const len = total > 0 ? (r.count / total) * C : 0;
              const dash = Math.max(len - gap, 0.5);
              return (
                <circle
                  key={r.key}
                  cx="70"
                  cy="70"
                  r={R}
                  fill="none"
                  strokeWidth="16"
                  strokeDasharray={`${dash.toFixed(2)} ${(C - dash).toFixed(2)}`}
                  strokeDashoffset={-((total > 0 ? (before / total) * C : 0) + gap / 2)}
                  style={{ stroke: r.colour }}
                />
              );
            })}
          </g>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-headline leading-none text-ink tnum">{total}</span>
          <span className="mt-0.5 text-caption lowercase text-ink-2">{unit}</span>
        </div>
      </div>
      <ul aria-label={label} className="flex min-w-0 flex-1 flex-col gap-2.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-small">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: r.colour }}
            />
            <span className="min-w-0 flex-1 break-words text-ink">{r.label}</span>
            <span className="font-medium text-ink tnum">{r.count}</span>
            <span className="w-9 text-right text-caption text-ink-2 tnum">
              {total > 0 ? Math.round((r.count / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Columns side by side (a year or a month each), with the figure above and the label below; optionally two
 * heights per column (a part of the whole). `highlight` marks the column that is "now".
 */
export function Columns({
  label,
  columns,
  colour,
  partColour,
  highlight,
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
  highlight?: number;
}) {
  const max = Math.max(1, ...columns.map((c) => c.value));
  const base = colour ?? "var(--accent)";
  return (
    <ol aria-label={label} className="flex h-40 items-stretch gap-1">
      {columns.map((c, i) => {
        const on = i === highlight;
        return (
          <li key={c.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="sr-only">{c.text}</span>
            <span
              aria-hidden="true"
              className={cn(
                "h-3 text-[10px] leading-3 tnum",
                on ? "font-semibold text-ink" : "text-ink-2",
              )}
            >
              {c.value > 0 ? c.value : ""}
            </span>
            <span aria-hidden="true" className="flex min-h-0 w-full flex-1 items-end">
              <span
                className="flex w-full flex-col justify-end overflow-hidden rounded-t-[5px] rounded-b-[2px]"
                style={{
                  height: `${(c.value / max) * 100}%`,
                  minHeight: c.value > 0 ? 4 : 2,
                  background:
                    c.value === 0
                      ? "var(--hairline)"
                      : on && partColour === undefined
                        ? base
                        : `color-mix(in srgb, ${base} 40%, transparent)`,
                }}
              >
                {c.part !== undefined && c.part > 0 && (
                  <span
                    className="block w-full"
                    style={{
                      height: `${(c.part / c.value) * 100}%`,
                      background: partColour ?? "var(--peak)",
                    }}
                  />
                )}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "h-3 text-[10px] leading-3 tnum",
                on ? "font-semibold text-ink" : "text-ink-3",
              )}
            >
              {c.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export interface TimelineRow {
  key: string;
  href: string;
  name: string;
  /** "2016" or "NV" */
  vintage: string;
  type: WineType;
  producer: string;
  from: number;
  until: number;
  /** The wine's stage today, in words, and its colour. */
  phaseLabel: string;
  colour: string;
  /** "2024–2031" */
  range: string;
}

/**
 * "When to drink": a window bar per wine on ONE shared year axis, with a tick for today. The bar is coloured by the
 * wine's stage today; the stage, the years and the name are all text, the bars only show how they sit together.
 */
export function WindowTimeline({
  label,
  rows,
  now,
  todayLabel,
}: {
  label: string;
  rows: readonly TimelineRow[];
  /** Today as a fractional year (2026.78). */
  now: number;
  todayLabel: string;
}) {
  const nowYear = Math.floor(now);
  const lo = Math.min(nowYear, ...rows.map((r) => r.from));
  const hi = Math.max(nowYear + 1, ...rows.map((r) => r.until + 1));
  const span = Math.max(hi - lo, 4);
  const pct = (year: number) => Math.min(100, Math.max(0, ((year - lo) / span) * 100));
  const step = [1, 2, 5, 10, 20].find((s) => span / s <= 5) ?? 25;
  const ticks: number[] = [];
  for (let y = lo; y <= lo + span; y += step) ticks.push(y);
  return (
    <div>
      <ul aria-label={label} className="flex flex-col gap-4">
        {rows.map((r) => {
          const left = pct(r.from);
          const width = Math.max(pct(r.until + 1) - left, 1.5);
          return (
            <li key={r.key} className="relative flex items-center gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  "relative flex h-12 w-9 shrink-0 items-end justify-center overflow-hidden rounded-[10px]",
                  STAGE[r.type],
                )}
              >
                <span className="absolute -bottom-4 left-1/2 size-8 -translate-x-1/2 rounded-full bg-surface/45" />
                <BottleGlyph
                  shape={shapeFor(r.type)}
                  tint={r.type}
                  mark={labelMark(r.producer, r.name)}
                  className="relative mb-1 w-3"
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <Link
                    href={r.href}
                    className="min-w-0 truncate text-small text-ink after:absolute after:inset-0"
                  >
                    {r.name} <span className="text-ink-3 tnum">{r.vintage}</span>
                  </Link>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-caption text-ink-2">
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full"
                      style={{ background: r.colour }}
                    />
                    {r.phaseLabel}
                  </span>
                </div>
                <div aria-hidden="true" className="relative mt-2 h-2 rounded-full bg-raised">
                  <span
                    className="absolute inset-y-0 rounded-full"
                    style={{ left: `${left}%`, width: `${width}%`, background: r.colour }}
                  />
                  <span
                    className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink"
                    style={{ left: `${pct(now)}%` }}
                  />
                </div>
                <p className="mt-1 text-caption text-ink-3 tnum">{r.range}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <div aria-hidden="true" className="relative ml-12 mt-3 h-4 text-caption text-ink-3 tnum">
        {ticks.map((y) => (
          <span
            key={y}
            className="absolute top-0 leading-4"
            style={{ left: `${pct(y)}%`, transform: `translateX(-${pct(y)}%)` }}
          >
            {y}
          </span>
        ))}
      </div>
      <p className="ml-12 mt-2 flex items-center gap-2 text-caption text-ink-2">
        <span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-ink" />
        {todayLabel}
      </p>
    </div>
  );
}

/**
 * A value over time, as a calm area under a line (accent colour), with the first and last month and the lowest and
 * highest amount written out. The numbers are in a list for screen readers; the drawing is decoration.
 */
export function ValueLine({
  label,
  points,
  format,
  monthLabel,
}: {
  label: string;
  points: ReadonlyArray<{ month: string; cents: number }>;
  format: (cents: number) => string;
  monthLabel: (month: string) => string;
}) {
  const W = 320;
  const H = 120;
  const pad = 6;
  const values = points.map((p) => p.cents);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // a flat line sits in the middle rather than at the floor
  const span = max - min || Math.max(1, max * 0.2);
  const lo = max === min ? min - span / 2 : min;
  const x = (i: number) =>
    points.length === 1 ? W / 2 : pad + (i / (points.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.cents).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`;
  const last = points.at(-1)!;
  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className="h-36 w-full overflow-visible"
      >
        <defs>
          <linearGradient id="value-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#value-area)" />
        <path
          d={line}
          fill="none"
          stroke="var(--accent-fg)"
          strokeWidth="2.25"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={x(points.length - 1)}
          cy={y(last.cents)}
          r="3.5"
          fill="var(--accent-fg)"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div aria-hidden="true" className="flex justify-between text-caption text-ink-3 tnum">
        <span>{monthLabel(points[0]!.month)}</span>
        <span>
          {format(min)} – {format(max)}
        </span>
        <span>{monthLabel(last.month)}</span>
      </div>
      <ol aria-label={label} className="sr-only">
        {points.map((p) => (
          <li key={p.month}>
            {monthLabel(p.month)}: {format(p.cents)}
          </li>
        ))}
      </ol>
    </figure>
  );
}
