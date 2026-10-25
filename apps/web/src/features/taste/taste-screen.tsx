"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  MIN_FAVOURITE_WINES,
  MIN_TREND_WINES,
  formatStars,
  formatVintage,
  offerTasteOnboarding,
  tasteTabs,
  TASTE_SCALES,
  type Favourite,
  type TasteProfileView,
  type TasteScale,
  type TasteSection,
  type WineRef,
  type WineType,
} from "@cellr/domain";
import { wineFill } from "@/features/stats/charts";
import { buttonStyles } from "@/ui/button";
import { cn } from "@/ui/cn";
import { EmptyState } from "@/ui/empty-state";
import { StarIcon } from "@/ui/icons";
import { PageHeader } from "@/ui/page-header";
import { TasteGauge } from "./gauge";
import { useTasteProfile } from "./hooks";
import { PreferencesSheet } from "./preferences-sheet";

type Tab = "overview" | WineType;

/** My taste profile: what I tasted, what I rate highly, and where I like a wine to sit. */
export function TasteScreen({ initial }: { initial: TasteProfileView }) {
  const t = useTranslations("taste");
  const tTypes = useTranslations("wineTypes");
  const { data } = useTasteProfile(initial);
  const [tab, setTab] = useState<Tab>("overview");
  const [sheet, setSheet] = useState<null | "onboarding" | "edit">(null);
  const tabs: Tab[] = ["overview", ...tasteTabs(data)];

  if (!data.ready.tastings)
    return (
      <>
        <PageHeader title={t("title")} />
        <EmptyState title={t("notReady")} />
      </>
    );

  const section: TasteSection | undefined = tab === "overview" ? data.overview : data.byType[tab];
  const scales: TasteScale[] =
    tab === "overview" || tab === "red" || tab === "orange"
      ? [...TASTE_SCALES]
      : TASTE_SCALES.filter((s) => s !== "tannin");

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Hero view={data} />

      {offerTasteOnboarding(data) && data.ready.preferences && (
        <div className="mt-4 flex flex-col items-start gap-3 rounded-[22px] bg-raised p-4">
          <p className="font-display text-title text-ink">{t("onboarding.offerTitle")}</p>
          <p className="text-small text-ink-2">{t("onboarding.offerBody")}</p>
          <button
            type="button"
            onClick={() => setSheet("onboarding")}
            className={buttonStyles({ variant: "primary", size: "md" })}
          >
            {t("onboarding.start")}
          </button>
        </div>
      )}

      <div
        role="tablist"
        aria-label={t("tabsLabel")}
        className="-mx-5 mt-6 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0"
      >
        {tabs.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`taste-tab-${k}`}
            aria-selected={tab === k}
            aria-controls="taste-panel"
            onClick={() => setTab(k)}
            className={cn(
              "min-h-11 shrink-0 rounded-full px-4 text-small font-medium transition-colors duration-150 motion-reduce:transition-none",
              tab === k ? "bg-ink text-canvas" : "bg-raised text-ink-2 hover:text-ink",
            )}
          >
            {k === "overview" ? t("overview") : tTypes(k)}
          </button>
        ))}
      </div>

      <section
        id="taste-panel"
        role="tabpanel"
        aria-labelledby={`taste-tab-${tab}`}
        className="mt-5 flex flex-col gap-6"
      >
        {!section ? (
          <p className="rounded-[22px] bg-surface p-5 text-body text-ink-2 shadow-raised">
            {t("typeEmpty", { type: tTypes(tab as WineType) })}
          </p>
        ) : (
          <>
            {tab !== "overview" && <TypeSummary section={section} />}
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-title text-ink">{t("preferencesTitle")}</h2>
                {data.ready.preferences && (
                  <button
                    type="button"
                    onClick={() => setSheet("edit")}
                    className="min-h-11 px-2 text-small font-medium text-accent-fg"
                  >
                    {t("edit.action")}
                  </button>
                )}
              </div>
              <p className="mt-1 text-caption text-ink-2">
                {t("preferencesNote", { count: MIN_TREND_WINES })}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {scales.map((s) => (
                  <TasteGauge
                    key={s}
                    scale={s}
                    mine={data.preferences[s]}
                    trend={section.trends[s]}
                  />
                ))}
              </div>
            </div>
            {tab === "overview" && <Distribution view={data} />}
            {tab === "overview" && (
              <Favourites
                title={t("styles")}
                items={section.favouriteStyles}
                name={(k) => tTypes(k as WineType)}
                empty={t("notEnough", { count: MIN_FAVOURITE_WINES })}
              />
            )}
            <Favourites
              title={t("regions")}
              items={section.favouriteRegions}
              empty={t("notEnough", { count: MIN_FAVOURITE_WINES })}
            />
            <Favourites
              title={t("grapes")}
              items={section.favouriteGrapes}
              empty={
                section.grapesKnown < MIN_FAVOURITE_WINES
                  ? t("grapesUnknown")
                  : t("notEnough", { count: MIN_FAVOURITE_WINES })
              }
            />
            {section.mostTastedRegions.length > 0 && (
              <div>
                <h2 className="font-display text-title text-ink">{t("mostTasted")}</h2>
                <p className="mt-1 text-caption text-ink-2">{t("mostTastedNote")}</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {section.mostTastedRegions.map((r) => (
                    <li
                      key={r.key}
                      className="rounded-full border border-hairline px-3 py-1 text-small text-ink"
                    >
                      {r.key}{" "}
                      <span className="text-ink-3 tnum">· {t("wines", { count: r.wines })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      <p className="mt-8 text-caption text-ink-3">{t("method", { count: MIN_FAVOURITE_WINES })}</p>
      <div className="mt-3">
        <Link
          href="/ratings"
          className="text-small font-medium text-accent-fg underline-offset-2 hover:underline"
        >
          {t("toRatings")}
        </Link>
      </div>

      {sheet && (
        <PreferencesSheet
          key={sheet}
          open
          onClose={() => setSheet(null)}
          current={data.preferences}
          onboarding={sheet === "onboarding"}
        />
      )}
    </>
  );
}

function Hero({ view }: { view: TasteProfileView }) {
  const t = useTranslations("taste");
  const o = view.overview;
  const toGo = Math.max(0, MIN_FAVOURITE_WINES - o.winesRated);
  return (
    <section
      aria-label={t("heroLabel")}
      className="mt-2 grid grid-cols-3 gap-2 rounded-[26px] bg-surface p-5 shadow-raised"
    >
      <Figure value={String(o.winesTasted)} label={t("winesTasted")} />
      <Figure value={String(o.winesRated)} label={t("winesRated")} />
      <Figure
        value={o.average === null ? "—" : String(o.average)}
        label={t("average")}
        star={o.average !== null}
      />
      <p className="col-span-3 mt-2 text-center text-caption text-ink-2">
        {o.tastings === 0
          ? t("heroEmpty")
          : toGo > 0
            ? t("heroToGo", { count: toGo })
            : t("heroReady", { count: o.tastings })}
      </p>
    </section>
  );
}

function Figure({ value, label, star = false }: { value: string; label: string; star?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span className="flex items-center gap-1 font-display text-display tnum text-ink">
        {value}
        {star && (
          <StarIcon size={18} fill="currentColor" className="text-accent-fg" aria-hidden="true" />
        )}
      </span>
      <span className="text-caption text-ink-2">{label}</span>
    </div>
  );
}

function TypeSummary({ section }: { section: TasteSection }) {
  const t = useTranslations("taste");
  return (
    <p className="rounded-[22px] bg-surface p-4 text-small text-ink-2 shadow-raised">
      {t("typeSummary", { wines: section.winesTasted, rated: section.winesRated })}
      {section.average !== null && ` · ${t("typeAverage", { stars: section.average })}`}
    </p>
  );
}

/** What I have tasted, by kind: frequency, shown apart from what I rate highly. */
function Distribution({ view }: { view: TasteProfileView }) {
  const t = useTranslations("taste");
  const tTypes = useTranslations("wineTypes");
  const total = view.distribution.reduce((s, d) => s + d.wines, 0);
  if (total === 0) return null;
  return (
    <div>
      <h2 className="font-display text-title text-ink">{t("distribution")}</h2>
      <p className="mt-1 text-caption text-ink-2">{t("distributionNote")}</p>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full" aria-hidden="true">
        {view.distribution.map((d) => (
          <span
            key={d.type}
            style={{ width: `${(d.wines / total) * 100}%`, background: wineFill(d.type) }}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-col gap-1.5">
        {view.distribution.map((d) => (
          <li key={d.type} className="flex items-center gap-2 text-small text-ink">
            <span
              className="size-3 shrink-0 rounded-full"
              style={{ background: wineFill(d.type) }}
              aria-hidden="true"
            />
            <span className="flex-1">{tTypes(d.type)}</span>
            <span className="text-ink-2 tnum">
              {t("wines", { count: d.wines })}
              {d.average !== null && ` · ${t("typeAverage", { stars: d.average })}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExampleText({ e }: { e: WineRef }) {
  return (
    <>
      <span className="min-w-0 truncate">
        {e.producer} {e.wineName} {formatVintage(e.year)}
      </span>
      <span className="shrink-0 text-ink-2 tnum">{formatStars(e.score)}★</span>
    </>
  );
}

function Favourites({
  title,
  items,
  empty,
  name = (k) => k,
}: {
  title: string;
  items: Favourite[];
  empty: string;
  name?: (key: string) => string;
}) {
  const t = useTranslations("taste");
  return (
    <div>
      <h2 className="font-display text-title text-ink">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-small text-ink-2">{empty}</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-3">
          {items.map((f) => (
            <li key={f.key} className="rounded-[22px] bg-surface p-4 shadow-raised">
              <p className="flex items-baseline justify-between gap-3">
                <span className="font-display text-title text-ink">{name(f.key)}</span>
                <span className="flex items-center gap-1 text-small font-medium text-ink tnum">
                  <StarIcon
                    size={14}
                    fill="currentColor"
                    className="text-accent-fg"
                    aria-hidden="true"
                  />
                  {f.average}
                  <span className="sr-only">{t("averageSpoken", { stars: f.average })}</span>
                </span>
              </p>
              <p className="text-caption text-ink-2">{t("favouriteBasis", { count: f.wines })}</p>
              <ul className="mt-2 flex flex-col">
                {f.examples.map((e) => (
                  <li key={e.vintageId}>
                    {e.available ? (
                      <Link
                        href={`/cellar/${e.vintageId}`}
                        className="flex min-h-11 items-center justify-between gap-3 rounded-[12px] px-1 text-small text-ink hover:bg-raised"
                      >
                        <ExampleText e={e} />
                      </Link>
                    ) : (
                      <p
                        className="flex min-h-11 items-center justify-between gap-3 px-1 text-small text-ink"
                        data-testid="example-archived"
                      >
                        <ExampleText e={e} />
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
