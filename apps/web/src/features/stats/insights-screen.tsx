import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatVintage, type DrinkPhase, type StatsView, type WineType } from "@cellr/domain";
import { PHASE_COLOUR } from "@/features/cellar/drink-bits";
import { countryName, placeLine } from "@/features/cellar/wine-visuals";
import { buttonStyles } from "@/ui/button";
import { ChevronRightIcon } from "@/ui/icons";
import { EmptyState } from "@/ui/empty-state";
import { Stars } from "@/ui/stars";
import { BarList, Columns } from "./charts";

/**
 * The cellar in numbers: what is in it, what it cost and is worth, when it is ready, what you drank and what you
 * loved. Everything is worked out from what is already kept; nothing to fill in.
 */
export async function InsightsScreen({ stats }: { stats: StatsView }) {
  const t = await getTranslations("insightsPage");
  const tTypes = await getTranslations("wineTypes");
  const tDrink = await getTranslations("drink");
  const tc = await getTranslations("cellarFilters");
  const locale = await getLocale();
  const money = (cents: number) => {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: stats.currency,
        maximumFractionDigits: 0,
      }).format(cents / 100);
    } catch {
      return String(Math.round(cents / 100));
    }
  };
  const month = (m: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
      new Date(`${m}-01T00:00:00Z`),
    );
  const empty = stats.bottleCount === 0 && stats.openedCount === 0;

  if (empty)
    return (
      <div className="mx-auto w-full max-w-3xl pt-10 lg:pt-14">
        <h1 className="font-display text-display">{t("title")}</h1>
        <EmptyState
          className="mt-6"
          title={t("emptyTitle")}
          body={t("emptyBody")}
          action={
            <Link href="/cellar/add" className={buttonStyles({ variant: "primary", size: "lg" })}>
              {t("emptyAction")}
            </Link>
          }
        />
      </div>
    );

  const { money: m } = stats;
  const decade = (k: string) =>
    k === "nv" ? tc("bands.nv") : k === "older" ? tc("bands.older") : k;
  const phaseOrder: DrinkPhase[] = ["young", "developing", "peak", "ready", "past", "unknown"];
  const byPhase = phaseOrder.flatMap((p) => {
    const c = stats.byPhase.find((x) => x.key === p)?.count ?? 0;
    return c > 0
      ? [{ key: p, label: tDrink(`phase.${p}`), count: c, colour: PHASE_COLOUR[p] }]
      : [];
  });
  const anyReady = stats.readyByYear.some((y) => y.ready > 0);
  const anyOpened = stats.openedByMonth.some((x) => x.count > 0);

  return (
    <div className="mx-auto w-full max-w-3xl pt-10 lg:pt-14">
      <h1 className="font-display text-display">{t("title")}</h1>
      <p className="mt-2 text-body text-ink-2">{t("subtitle")}</p>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="stat-tiles">
        <Tile label={t("bottles")} value={String(stats.bottleCount)} />
        <Tile label={t("wines")} value={String(stats.wineCount)} />
        <Tile
          label={t("spent")}
          value={m.spentCents === null ? "–" : money(m.spentCents)}
          note={m.spentCents === null ? t("noPrices") : t("pricedNote", { count: m.pricedCount })}
        />
        <Tile
          label={t("worth")}
          value={m.worthCents === null ? "–" : money(m.worthCents)}
          note={
            m.worthCents === null
              ? t("noValues")
              : m.gainCents === null
                ? t("valuedNote", { count: m.valuedCount })
                : t(m.gainCents >= 0 ? "gainNote" : "lossNote", {
                    amount: money(Math.abs(m.gainCents)),
                    count: m.comparedCount,
                  })
          }
        />
      </dl>

      <div className="mt-8 flex flex-col gap-4">
        <Card title={t("typesTitle")}>
          <BarList
            label={t("typesTitle")}
            rows={stats.byType.map((x) => ({
              key: x.key,
              label: tTypes(x.key as WineType),
              count: x.count,
              colour: `var(--wine-${x.key})`,
            }))}
          />
        </Card>

        {stats.bottleCount > 0 && (
          <Card title={t("whereTitle")}>
            <BarList
              label={t("countries")}
              rows={stats.byCountry.map((x) => ({
                key: x.key,
                label: x.key === "unknown" ? t("unknown") : (countryName(x.key, locale) ?? x.key),
                count: x.count,
              }))}
            />
            {stats.byRegion.length > 0 && (
              <>
                <h3 className="mb-3 mt-6 text-small font-medium text-ink-2">{t("regions")}</h3>
                <BarList
                  label={t("regions")}
                  rows={stats.byRegion.map((x) => {
                    const [name, code] = x.key.split("|");
                    return {
                      key: x.key,
                      label: placeLine(name ?? x.key, code ?? null, locale),
                      count: x.count,
                    };
                  })}
                />
              </>
            )}
            <h3 className="mb-3 mt-6 text-small font-medium text-ink-2">{t("decades")}</h3>
            <BarList
              label={t("decades")}
              rows={stats.byDecade.map((x) => ({
                key: x.key,
                label: decade(x.key),
                count: x.count,
              }))}
            />
            <h3 className="mb-3 mt-6 text-small font-medium text-ink-2">{t("producers")}</h3>
            <BarList
              label={t("producers")}
              rows={stats.byProducer.map((x) => ({ key: x.key, label: x.key, count: x.count }))}
            />
          </Card>
        )}

        {stats.bottleCount > 0 && (
          <Card title={t("drinkTitle")}>
            <BarList label={t("drinkNow")} rows={byPhase} />
            {anyReady && (
              <>
                <h3 className="mb-3 mt-6 text-small font-medium text-ink-2">{t("readyByYear")}</h3>
                <Columns
                  label={t("readyByYear")}
                  colour={PHASE_COLOUR.ready}
                  partColour={PHASE_COLOUR.peak}
                  columns={stats.readyByYear.map((y) => ({
                    key: String(y.year),
                    label: String(y.year).slice(2),
                    value: y.ready,
                    part: y.peak,
                    text: t("yearText", { year: y.year, ready: y.ready, peak: y.peak }),
                  }))}
                />
                <p className="mt-3 text-caption text-ink-2">{t("readyByYearNote")}</p>
              </>
            )}
            <p className="mt-4 text-caption text-ink-2">{tDrink("estimate")}</p>
          </Card>
        )}

        <Card title={t("drankTitle")}>
          {anyOpened ? (
            <Columns
              label={t("openedByMonth")}
              columns={stats.openedByMonth.map((x) => ({
                key: x.month,
                label: month(x.month),
                value: x.count,
                text: t("monthText", { month: month(x.month), count: x.count }),
              }))}
            />
          ) : (
            <p className="text-body text-ink-2">{t("noneOpened")}</p>
          )}
          <p className="mt-3 text-small text-ink-2">
            {t("openedTotal", { count: stats.openedCount })}
          </p>
        </Card>

        {stats.topRated.length > 0 && (
          <Card title={t("lovedTitle")}>
            <ol className="flex flex-col divide-y divide-hairline" aria-label={t("topRated")}>
              {stats.topRated.map((r) => (
                <li key={r.vintageId} className="relative flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/cellar/${r.vintageId}`}
                      className="block truncate font-display text-title text-ink after:absolute after:inset-0"
                    >
                      {r.wineName}
                    </Link>
                    <p className="truncate text-small text-ink-2">
                      {r.producer} · <span className="tnum">{formatVintage(r.year)}</span>
                    </p>
                  </div>
                  <Stars
                    score={Math.round(r.stars * 2)}
                    label={t("starsOf", { stars: r.stars })}
                    size={14}
                  />
                </li>
              ))}
            </ol>
            {stats.ratingByType.length > 1 && (
              <>
                <h3 className="mb-3 mt-6 text-small font-medium text-ink-2">{t("ratingByType")}</h3>
                <BarList
                  label={t("ratingByType")}
                  rows={stats.ratingByType.map((x) => ({
                    key: x.type,
                    label: tTypes(x.type),
                    count: x.stars,
                    colour: `var(--wine-${x.type})`,
                  }))}
                />
              </>
            )}
          </Card>
        )}
      </div>

      <Link
        href="/cellar"
        className="mt-8 inline-flex min-h-11 items-center gap-1 text-small font-medium text-accent-fg"
      >
        {t("toCellar")}
        <ChevronRightIcon size={16} />
      </Link>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-hairline bg-surface p-5">
      <h2 className="mb-4 text-caption font-medium uppercase tracking-[0.18em] text-ink-3">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col-reverse justify-end rounded-card border border-hairline bg-surface p-4">
      <dt className="mt-2 text-small text-ink-2">
        {label}
        {note && <span className="mt-0.5 block text-caption">{note}</span>}
      </dt>
      <dd className="font-display text-headline leading-none tnum">{value}</dd>
    </div>
  );
}
