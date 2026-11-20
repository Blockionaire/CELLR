"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo } from "react";
import { zoneSummaries, type SmartStorageUnitView } from "@cellr/domain";
import { cn } from "@/ui/cn";
import { resolvedFromView } from "../storage3d/from-api";

/** A set temperature in the reader's notation ("8.0" in English, "8,0" in Dutch). */
export const tempText = (locale: string, celsius: number): string =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    celsius,
  );

/**
 * A place's temperature zones in daily use (Smart Cellar 3D, sprint 4): which shelves, what for, the temperature it
 * is SET to (or that none is set) and how many bottles each holds. Shown only for a place that has zones: a place
 * without them is never given a temperature. Editing goes to the Rack Builder's zones, its one atomic save.
 */
export function ZoneLegend({
  unit,
  occupants,
  builderOpen,
}: {
  unit: SmartStorageUnitView;
  occupants: ReadonlyArray<{ row: number; col: number; index: number }>;
  builderOpen: boolean;
}) {
  const t = useTranslations("placement");
  const format = useFormatter();
  const zones = useMemo(() => zoneSummaries(resolvedFromView(unit), occupants), [unit, occupants]);
  if (zones.length === 0) return null;
  return (
    <section
      aria-label={t("zonesTitle")}
      className="flex flex-col gap-2"
      data-testid="zone-legend"
      data-zones={zones.length}
    >
      <ul className="flex flex-wrap gap-2">
        {zones.map((z) => (
          <li
            key={z.number}
            data-zone={z.number}
            data-purpose={z.purpose}
            className={cn(
              "flex flex-col gap-0.5 rounded-card px-3 py-2 text-small ring-1 ring-hairline",
              z.purpose === "serving" ? "bg-[#f3e6da]" : "bg-[#e6ebf0]",
              "text-[#2a2420]",
            )}
          >
            <span className="font-medium">
              {t("zoneLine", {
                n: z.number,
                purpose: t(`zone.${z.purpose}`),
                count: z.toRow - z.fromRow + 1,
                from: z.fromRow,
                to: z.toRow,
              })}
            </span>
            <span className="text-caption opacity-80" data-testid="zone-temp">
              {z.targetTempC === null
                ? t("notSet")
                : t("setTo", {
                    temp: format.number(z.targetTempC, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    }),
                  })}
              {" · "}
              {t("bottlesInZone", { count: z.bottles })}
            </span>
          </li>
        ))}
      </ul>
      <p className="flex flex-wrap items-center gap-x-3 text-caption text-ink-2">
        <span>{t("settingNote")}</span>
        {builderOpen && (
          <Link
            href={`/cellar/builder/${unit.id}?section=zones`}
            className="underline underline-offset-2"
            data-testid="zone-edit"
          >
            {t("editZones")}
          </Link>
        )}
      </p>
    </section>
  );
}
