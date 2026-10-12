"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import {
  chartYears,
  drinkQuality,
  windowStretches,
  yearFraction,
  type DrinkSummary,
} from "@cellr/domain";
import { PHASE_COLOUR } from "./drink-bits";
import { useDay } from "./bottle-bits";

const W = 320;
const H = 150;
const PAD = 10;
const TOP = 16;
const BOTTOM = 28;

/**
 * A wine's life as a picture: how good it is over the years (climbing, at its best, easing off), in the colours
 * of its stretches, with today marked and a dot where each bottle of it was opened. The same estimate as the words
 * beside it, drawn: never a promise.
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
  const clipId = useId().replace(/:/g, "");
  if (drink.from === null || drink.until === null || drink.position === null) return null;
  const { from, until } = drink;
  const today = from + drink.position * Math.max(1, until - from);
  const { start, end } = chartYears(year, from, until);
  const x = (v: number) => PAD + ((v - start) / (end - start)) * (W - 2 * PAD);
  const y = (q: number) => TOP + (1 - q) * (H - TOP - BOTTOM);
  const base = H - BOTTOM;

  const samples = Array.from({ length: 61 }, (_, i) => {
    const v = start + ((end - start) * i) / 60;
    return { v, q: drinkQuality(v, from, until) };
  });
  const line = samples
    .map((s, i) => `${i === 0 ? "M" : "L"}${x(s.v).toFixed(1)},${y(s.q).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(end).toFixed(1)},${base} L${x(start).toFixed(1)},${base} Z`;
  const stretches = windowStretches(from, until);
  const bands: Array<[number, number, string]> = [
    [start, from, PHASE_COLOUR.young],
    [stretches.opening[0], stretches.opening[1], PHASE_COLOUR.developing],
    [stretches.best[0], stretches.best[1], PHASE_COLOUR.peak],
    [stretches.ready[0], stretches.ready[1], PHASE_COLOUR.ready],
    [until, end, PHASE_COLOUR.past],
  ];
  const marks = opened.flatMap((o) => (o.openedAt ? [o.openedAt] : []));
  const bestFrom = Math.round(stretches.best[0]);
  const bestUntil = Math.round(stretches.best[1]);
  const todayX = Math.min(x(end), Math.max(x(start), x(today)));

  return (
    <figure className="mt-5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t("chartLabel", { from, until, bestFrom, bestUntil })}
        className="w-full"
        data-testid="drink-chart"
      >
        <defs>
          <clipPath id={clipId}>
            <path d={area} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {bands.map(([a, b, colour]) => (
            <rect
              key={colour}
              x={x(a)}
              y={TOP - 4}
              width={Math.max(0, x(b) - x(a))}
              height={H - TOP - BOTTOM + 4}
              fill={colour}
              opacity={0.55}
            />
          ))}
        </g>
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.55}
          strokeWidth={1.5}
          className="text-ink"
        />
        <line
          x1={PAD}
          x2={W - PAD}
          y1={base}
          y2={base}
          stroke="currentColor"
          strokeOpacity={0.25}
          className="text-ink"
        />
        <line
          x1={todayX}
          x2={todayX}
          y1={TOP - 6}
          y2={base}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          className="text-ink"
        />
        <text
          x={todayX}
          y={TOP - 8}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
          className="text-ink"
        >
          {t("today")}
        </text>
        {[from, until].map((v) => (
          <text
            key={v}
            x={x(v)}
            y={H - 10}
            textAnchor="middle"
            fontSize={10}
            fill="currentColor"
            className="text-ink-2 tnum"
          >
            {v}
          </text>
        ))}
        {marks.map((iso, i) => {
          const v = Math.min(end, Math.max(start, yearFraction(iso)));
          return (
            <g key={`${iso}-${i}`} data-testid="opened-mark">
              <circle
                cx={x(v)}
                cy={y(drinkQuality(v, from, until))}
                r={5}
                fill="var(--surface)"
                stroke="currentColor"
                strokeWidth={2}
                className="text-ink"
              />
              <title>{t("openedMark", { day: day(iso) })}</title>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-2">
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
