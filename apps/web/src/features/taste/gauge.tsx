"use client";

import { useTranslations } from "next-intl";
import type { TasteScale } from "@cellr/domain";

/** Where a 1..5 value sits on the arc, as an angle from the left end (180°) to the right end (0°). */
const angleOf = (v: number) => Math.PI - ((Math.min(5, Math.max(1, v)) - 1) / 4) * Math.PI;
const point = (v: number, r: number) => ({
  x: 60 + r * Math.cos(angleOf(v)),
  y: 60 - r * Math.sin(angleOf(v)),
});

/**
 * One taste scale as a curved gauge: my own setting (a solid marker) and, when there is enough evidence, the
 * trend from wines I rated highly (a ring). The words under it say both, so the picture is never the only source.
 */
export function TasteGauge({
  scale,
  mine,
  trend,
}: {
  scale: TasteScale;
  mine: number | null;
  trend: { value: number; wines: number } | null;
}) {
  const t = useTranslations("taste");
  const r = 46;
  const level = (v: number) =>
    t(`scales.${scale}.levels.${String(v) as "1" | "2" | "3" | "4" | "5"}`);
  const arc = (from: number, to: number) => {
    const a = point(from, r);
    const b = point(to, r);
    return `M ${a.x} ${a.y} A ${r} ${r} 0 0 1 ${b.x} ${b.y}`;
  };
  const label = [
    t(`scales.${scale}.name`),
    mine !== null
      ? t("gauge.mineSpoken", { value: mine, word: level(mine) })
      : t("gauge.mineUnset"),
    trend
      ? t("gauge.trendSpoken", { value: trend.value, count: trend.wines })
      : t("gauge.trendNone"),
  ].join(". ");
  return (
    <figure className="flex flex-col items-center gap-1 rounded-[22px] bg-surface p-4 shadow-raised">
      <svg viewBox="0 0 120 70" className="w-full max-w-[180px]" role="img" aria-label={label}>
        <path
          d={arc(1, 5)}
          fill="none"
          stroke="var(--raised)"
          strokeWidth="9"
          strokeLinecap="round"
        />
        {mine !== null && (
          <path
            d={arc(1, mine)}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="9"
            strokeLinecap="round"
          />
        )}
        {trend && (
          <circle
            cx={point(trend.value, r).x}
            cy={point(trend.value, r).y}
            r="6.5"
            fill="var(--surface)"
            stroke="var(--bronze)"
            strokeWidth="2.5"
          />
        )}
        {mine !== null && (
          <circle cx={point(mine, r).x} cy={point(mine, r).y} r="4.5" fill="var(--accent-fg)" />
        )}
      </svg>
      <figcaption className="w-full text-center">
        <p className="font-display text-title text-ink">{t(`scales.${scale}.name`)}</p>
        <p className="mt-0.5 flex justify-between text-caption text-ink-3" aria-hidden="true">
          <span>{t(`scales.${scale}.low`)}</span>
          <span>{t(`scales.${scale}.high`)}</span>
        </p>
        <p className="mt-1 text-caption text-ink-2" aria-hidden="true">
          {mine !== null ? t("gauge.mine", { word: level(mine) }) : t("gauge.mineUnsetShort")}
        </p>
        <p className="text-caption text-ink-3" aria-hidden="true">
          {trend
            ? t("gauge.trend", { value: trend.value, count: trend.wines })
            : t("gauge.trendNoneShort")}
        </p>
      </figcaption>
    </figure>
  );
}
