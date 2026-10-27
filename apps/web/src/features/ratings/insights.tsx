"use client";

import { useTranslations } from "next-intl";
import type { Favourite, RatingInsights } from "@cellr/domain";
import { StarIcon } from "@/ui/icons";

const CARD = "rounded-[22px] bg-surface p-4 shadow-raised";

/** "4.4 ★ · 3 wines": a mean always says how many wines are behind it. */
function Mean({ average, wines }: { average: number; wines: number }) {
  const t = useTranslations("ratings");
  return (
    <span className="flex shrink-0 items-center gap-1 text-small text-ink tnum">
      <StarIcon size={13} fill="currentColor" className="text-accent-fg" />
      <span className="font-medium">{average.toFixed(1)}</span>
      <span className="text-caption text-ink-2">· {t("insights.wines", { count: wines })}</span>
    </span>
  );
}

/** A bar for a mean, on the 1–5 scale (so bars of different rows compare honestly). */
function Bar({ average }: { average: number }) {
  return (
    <span className="h-2 flex-1 overflow-hidden rounded-full bg-raised" aria-hidden="true">
      <span
        className="block h-full rounded-full bg-accent transition-[width] duration-500 ease-cellr motion-reduce:transition-none"
        style={{ width: `${Math.max(0, Math.min(1, (average - 1) / 4)) * 100}%` }}
      />
    </span>
  );
}

function FavouriteList({ title, list }: { title: string; list: Favourite[] }) {
  if (list.length === 0) return null;
  return (
    <div>
      <h4 className="text-caption font-medium uppercase tracking-[0.12em] text-bronze">{title}</h4>
      <ul className="mt-2 flex flex-col gap-1.5">
        {list.map((f) => (
          <li key={f.key} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-body text-ink">{f.key}</span>
            <Mean average={f.average} wines={f.wines} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What my ratings say, beyond the numbers: which kinds of wine I rate highest, favourite regions and grapes, the
 * difference between what I drink most and what I rate best, a discovery, and how my ratings move over the years.
 * Each only when there is enough behind it (the domain decides); otherwise a gentle word on what would unlock it.
 */
export function RatingInsightsCard({ insights }: { insights: RatingInsights }) {
  const t = useTranslations("ratings");
  const tTypes = useTranslations("wineTypes");
  const i = insights;
  const anything =
    i.byType.length > 0 ||
    i.favouriteRegions.length > 0 ||
    i.favouriteGrapes.length > 0 ||
    i.oftenVsBest !== null ||
    i.discovery !== null ||
    i.overTime !== null;

  return (
    <section aria-labelledby="rating-insights" data-testid="rating-insights" className={CARD}>
      <h2 id="rating-insights" className="font-display text-title text-ink">
        {t("insights.title")}
      </h2>
      {!anything ? (
        <p className="mt-2 text-body text-ink-2" data-testid="insights-thin">
          {t("insights.thin", { count: i.winesRated })}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          {i.byType.length > 0 && (
            <div>
              <h3 className="text-caption font-medium uppercase tracking-[0.12em] text-bronze">
                {t("insights.byType")}
              </h3>
              <ul className="mt-2 flex flex-col gap-2" data-testid="insights-by-type">
                {i.byType.map((r) => (
                  <li key={r.type} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 truncate text-body text-ink">
                      {tTypes(r.type)}
                    </span>
                    <Bar average={r.average} />
                    <Mean average={r.average} wines={r.wines} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(i.favouriteRegions.length > 0 || i.favouriteGrapes.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FavouriteList title={t("insights.regions")} list={i.favouriteRegions} />
              <FavouriteList title={t("insights.grapes")} list={i.favouriteGrapes} />
            </div>
          )}

          {i.oftenVsBest && (
            <p
              className="rounded-[16px] bg-raised/70 p-3 text-body text-ink"
              data-testid="insights-contrast"
            >
              {t("insights.contrast", {
                often: i.oftenVsBest.often.key,
                oftenWines: i.oftenVsBest.often.wines,
                best: i.oftenVsBest.best.key,
                bestWines: i.oftenVsBest.best.wines,
                average: i.oftenVsBest.best.average.toFixed(1),
              })}
            </p>
          )}

          {i.discovery && (
            <p
              className="rounded-[16px] bg-raised/70 p-3 text-body text-ink"
              data-testid="insights-discovery"
            >
              {t("insights.discovery", {
                name:
                  i.discovery.kind === "style"
                    ? tTypes(i.discovery.favourite.key as Parameters<typeof tTypes>[0])
                    : i.discovery.favourite.key,
                wines: i.discovery.favourite.wines,
                average: i.discovery.favourite.average.toFixed(1),
                share: Math.round(i.discovery.share * 100),
              })}
            </p>
          )}

          {i.overTime && (
            <div>
              <h3 className="text-caption font-medium uppercase tracking-[0.12em] text-bronze">
                {t("insights.overTime")}
              </h3>
              <ul className="mt-2 flex flex-col gap-2" data-testid="insights-over-time">
                {i.overTime.map((p) => (
                  <li key={p.year} className="flex items-center gap-3">
                    <span className="w-12 shrink-0 text-body text-ink tnum">{p.year}</span>
                    <Bar average={p.average} />
                    <Mean average={p.average} wines={p.wines} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-caption text-ink-3">{t("insights.method")}</p>
        </div>
      )}
    </section>
  );
}
