"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import {
  chartYears,
  drinkQuality,
  windowStretches,
  yearFraction,
  type DrinkPhase,
  type DrinkSummary,
} from "@cellr/domain";
import { cn } from "@/ui/cn";

import { PHASE_COLOUR } from "./phase-colour";
import { useDay } from "./bottle-bits";

/** The drawing is 320 × 100 units, stretched to the card's width; text and dots are HTML so they stay crisp. */
const W = 320;
const H = 100;
const PAD = 12;
const TOP = 8;
const SPAN = 80;
const BASE = 92;
/** Closest two year labels may sit, in drawing units, before one has to give way. */
const LABEL_GAP = 46;

const PILL: Record<DrinkPhase, { pill: string; dot: string }> = {
  young: { pill: "bg-young-bg text-young-ink", dot: "bg-young" },
  developing: { pill: "bg-ready-bg text-ready-ink", dot: "bg-ready" },
  peak: { pill: "bg-peak-bg text-peak-ink", dot: "bg-peak" },
  ready: { pill: "bg-fading-bg text-fading-ink", dot: "bg-fading" },
  past: { pill: "bg-fading-bg text-fading-ink", dot: "bg-danger" },
  unknown: { pill: "bg-raised text-ink-2", dot: "bg-ink-3" },
};

/** "● At its best": where a wine stands in its life, as a tinted pill. Solid underneath, so it also floats on a photo. */
export function PhasePill({ phase, className }: { phase: DrinkPhase; className?: string }) {
  const t = useTranslations("drink");
  const look = PILL[phase];
  return (
    <span className={cn("inline-flex rounded-full bg-surface", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-caption font-semibold",
          look.pill,
        )}
      >
        <span aria-hidden="true" className={cn("size-2 rounded-full", look.dot)} />
        {t(`phase.${phase}`)}
      </span>
    </span>
  );
}

/** A smooth cubic path through the points (Catmull-Rom), so the curve has no corners. */
function smooth(points: ReadonlyArray<readonly [number, number]>): string {
  const f = (n: number) => n.toFixed(1);
  const first = points[0]!;
  let d = `M${f(first[0])},${f(first[1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    d +=
      ` C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)}` +
      ` ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)}` +
      ` ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

/**
 * A wine's life as a picture: how good it is over the years (climbing, at its best, easing off), as a soft curve
 * with its stretches tinted behind it, today marked on it and a dot where each bottle of it was opened. The same
 * estimate as the words beside it, drawn: never a promise.
 */
export function DrinkChart({
  drink,
  year,
  opened,
}: {
  drink: DrinkSummary;
  year: number | null;
  /** Bottles of this wine that were opened (a dot each, on the year they were). */
  opened: ReadonlyArray<{ openedAt: string | null }>;
}) {
  const t = useTranslations("drink");
  const day = useDay();
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  if (drink.from === null || drink.until === null || drink.position === null) return null;
  const { from, until } = drink;
  const today = from + drink.position * Math.max(1, until - from);
  const { start, end } = chartYears(year, from, until);
  const x = (v: number) => PAD + ((v - start) / (end - start)) * (W - 2 * PAD);
  const y = (q: number) => TOP + (1 - q) * SPAN;
  const left = (u: number) => `${((u / W) * 100).toFixed(2)}%`;
  const top = (u: number) => `${((u / H) * 100).toFixed(2)}%`;

  const points = Array.from({ length: 49 }, (_, i): [number, number] => {
    const v = start + ((end - start) * i) / 48;
    return [x(v), y(drinkQuality(v, from, until))];
  });
  const line = smooth(points);
  const area = `${line} L${x(end).toFixed(1)},${BASE} L${x(start).toFixed(1)},${BASE} Z`;

  const stretches = windowStretches(from, until);
  const bestFrom = Math.round(stretches.best[0]);
  const bestUntil = Math.round(stretches.best[1]);
  const marks = opened.flatMap((o) => (o.openedAt ? [o.openedAt] : []));

  const todayV = Math.min(end, Math.max(start, today));
  const todayX = x(todayV);
  const todayY = y(drinkQuality(todayV, from, until));
  const clampedLabel = Math.min(0.9, Math.max(0.1, todayX / W));

  /** The tinted stretches behind the curve: opening up, at its best, drink soon. */
  const bands = [
    { range: stretches.opening, tint: "bg-ready/10", round: "rounded-l-[10px]" },
    { range: stretches.best, tint: "bg-peak/15", round: "" },
    { range: stretches.ready, tint: "bg-fading/10", round: "rounded-r-[10px]" },
  ];

  /** Where "At its best" is written: the middle of the peak stretch, or beside today's line when it crosses it. */
  const bandA = x(stretches.best[0]);
  const bandB = x(stretches.best[1]);
  const room = 0.19 * W;
  let labelAt: number | null = null;
  if (todayX < bandA - 4 || todayX > bandB + 4) {
    if (bandB - bandA >= room) labelAt = (bandA + bandB) / 2;
  } else {
    const [a0, a1, b0, b1] = [bandA, todayX - 8, todayX + 8, bandB];
    const [from0, to0] = a1 - a0 >= b1 - b0 ? [a0, a1] : [b0, b1];
    if (to0 - from0 >= room) labelAt = (from0 + to0) / 2;
  }

  /** Years under the axis: the window's own two ends always, the chart's two ends when there is room. */
  const labels: Array<{ year: number; at: number }> = [];
  if (x(until) - x(from) < LABEL_GAP) {
    labels.push({ year: from, at: (x(from) + x(until)) / 2 });
  } else {
    labels.push({ year: from, at: x(from) }, { year: until, at: x(until) });
  }
  if (x(from) - x(start) >= LABEL_GAP) labels.unshift({ year: start, at: x(start) });
  if (x(end) - x(until) >= LABEL_GAP) labels.push({ year: end, at: x(end) });
  const merged = x(until) - x(from) < LABEL_GAP;

  return (
    <figure className="mt-5">
      <div
        role="img"
        aria-label={t("chartLabel", { from, until, bestFrom, bestUntil })}
        className="relative pt-7"
        data-testid="drink-chart"
      >
        <span
          className="absolute top-0 -translate-x-1/2 text-caption font-semibold text-accent-fg"
          style={{ left: `${(clampedLabel * 100).toFixed(2)}%` }}
        >
          {t("today")}
        </span>

        <div className="relative h-40">
          {bands.map(({ range, tint, round }) => (
            <span
              key={tint}
              aria-hidden="true"
              className={cn("absolute inset-y-0", tint, round)}
              style={{
                left: left(x(range[0])),
                width: left(Math.max(0, x(range[1]) - x(range[0]))),
              }}
            />
          ))}
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
            className="absolute inset-0 size-full overflow-visible"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: "var(--peak)", stopOpacity: 0.4 }} />
                <stop offset="1" style={{ stopColor: "var(--peak)", stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <path d={area} fill={`url(#${gradientId})`} />
            <path
              d={line}
              fill="none"
              stroke="var(--peak)"
              strokeWidth={8}
              strokeOpacity={0.14}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={line}
              fill="none"
              stroke="var(--peak)"
              strokeWidth={2.5}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={PAD}
              x2={W - PAD}
              y1={BASE}
              y2={BASE}
              stroke="var(--ink-3)"
              strokeOpacity={0.4}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={todayX}
              x2={todayX}
              y1={0}
              y2={BASE}
              stroke="var(--accent-fg)"
              strokeWidth={1.25}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {labelAt !== null && (
            <span
              className="pointer-events-none absolute top-[27%] -translate-x-1/2 text-center text-caption font-semibold leading-tight text-peak-ink"
              style={{ left: left(labelAt) }}
            >
              {t("phase.peak")}
              <br />
              <span className="tnum">
                {bestFrom}–{bestUntil}
              </span>
            </span>
          )}

          {marks.map((iso, i) => {
            const v = Math.min(end, Math.max(start, yearFraction(iso)));
            return (
              <span
                key={`${iso}-${i}`}
                data-testid="opened-mark"
                title={t("openedMark", { day: day(iso) })}
                className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-surface"
                style={{ left: left(x(v)), top: top(y(drinkQuality(v, from, until))) }}
              />
            );
          })}

          <span
            aria-hidden="true"
            className="absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-accent-fg/20"
            style={{ left: left(todayX), top: top(todayY) }}
          >
            <span className="size-3.5 rounded-full bg-accent-fg ring-2 ring-surface" />
          </span>
        </div>

        <div className="relative mt-2 h-5">
          {labels.map((l) => (
            <span
              key={l.year}
              className="absolute -translate-x-1/2 text-caption text-ink-2 tnum"
              style={{ left: left(l.at) }}
            >
              {merged && l.year === from ? `${from}–${until}` : l.year}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-2">
        <Legend
          colour={PHASE_COLOUR.developing}
          label={t("phase.developing")}
          years={`${from}–${Math.round(stretches.opening[1])}`}
        />
        <Legend
          colour={PHASE_COLOUR.peak}
          label={t("phase.peak")}
          years={`${bestFrom}–${bestUntil}`}
        />
        <Legend
          colour={PHASE_COLOUR.ready}
          label={t("phase.ready")}
          years={`${Math.round(stretches.ready[0])}–${until}`}
        />
        {marks.length > 0 && <span>{t("openedLegend", { count: marks.length })}</span>}
      </figcaption>
    </figure>
  );
}

function Legend({ colour, label, years }: { colour: string; label: string; years: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="size-2 rounded-full" style={{ background: colour }} />
      {label} <span className="tnum">{years}</span>
    </span>
  );
}
