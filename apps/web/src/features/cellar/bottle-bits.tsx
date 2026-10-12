"use client";

import { useLocale, useTranslations } from "next-intl";
import type { BottleView } from "@cellr/domain";

/** "Wine fridge · Shelf 2 · Position 3", or "Not placed yet". */
export function BottleSpot({
  bottle,
  short = false,
}: {
  bottle: Pick<BottleView, "locationLabel" | "row" | "col">;
  /** Leave out the place's name (when the surrounding text already says where). */
  short?: boolean;
}) {
  const t = useTranslations("vintage");
  if (bottle.locationLabel === null || bottle.row === null || bottle.col === null)
    return <>{t("notPlaced")}</>;
  const spot = t("spot", { row: bottle.row, col: bottle.col });
  return <>{short ? spot : `${bottle.locationLabel} · ${spot}`}</>;
}

/** Money in the household's currency, in the viewer's number format ("€ 24,50"). */
export function useMoney(currency: string | null) {
  const locale = useLocale();
  return (cents: number): string => {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currency ?? "EUR",
      }).format(cents / 100);
    } catch {
      return (cents / 100).toFixed(2);
    }
  };
}

/** "12 Oct 2026" from a calendar day or timestamp, without shifting across time zones. */
export function useDay() {
  const locale = useLocale();
  return (iso: string): string =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso));
}
