import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  formatVintage,
  type CellarItem,
  type DrinkPhase,
  type StatsView,
  type WineType,
} from "@cellr/domain";

import { PHASE_COLOUR } from "@/features/cellar/phase-colour";
import { countryName, placeLine } from "@/features/cellar/wine-visuals";
import { buttonStyles } from "@/ui/button";
import { ChevronRightIcon } from "@/ui/icons";
import { EmptyState } from "@/ui/empty-state";
import { PageHeader } from "@/ui/page-header";
import { Stars } from "@/ui/stars";
import {
  BarList,
  Columns,
  Donut,
  ValueLine,
  WindowTimeline,
  wineFill,
  type TimelineRow,
} from "./charts";

/** How many wines the "when to drink" timeline shows: the ones that need you first. */
const TIMELINE_ROWS = 6;

/** The tile behind each drinking stage: the maturity tints from the tokens (stages with no tint stay neutral). */
const STAGE_TILE: Record<DrinkPhase, string> = {
  young: "bg-young-bg text-young-ink",
  developing: "bg-ready-bg text-ready-ink",
  peak: "bg-peak-bg text-peak-ink",
  ready: "bg-fading-bg text-fading-ink",
  past: "bg-raised text-ink-2",
  unknown: "bg-raised text-ink-2",
};

/**
 * The cellar in numbers: what is in it, what it cost and is worth, when it is ready, what you drank and what you
 * loved. Everything is worked out from what is already kept; nothing to fill in. `cellar` (the same bottles, with
 * their drinking windows) only feeds the timeline of windows, and the screen is complete without it.
 */
export async function InsightsScreen({
  stats,
  cellar = [],
}: {
  stats: StatsView;
  cellar?: readonly CellarItem[];
}) {
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
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title={t("title")} />
        <EmptyState
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

  // Types: the ring and its legend.
  const typeRows = stats.byType.map((x) => ({
    key: x.key,
    label: tTypes(x.key as WineType),
    count: x.count,
    colour: wineFill(x.key),
  }));
  const typeSummary = `${t("typesTitle")}: ${typeRows
    .map((r) => `${r.label} ${r.count}`)
    .join(", ")}`;

  // Spent against worth: the bars compare the two totals, and only when
  // they cover the very same bottles; otherwise the figures and their notes stand alone.
  const comparable =
    m.spentCents !== null &&
    m.spentCents > 0 &&
    m.worthCents !== null &&
    m.pricedCount === m.valuedCount &&
    m.valuedCount === m.comparedCount;
  const gainShare =
    comparable && m.gainCents !== null && m.spentCents ? m.gainCents / m.spentCents : null;
  const gainText =
    gainShare === null
      ? null
      : new Intl.NumberFormat(locale, {
          style: "percent",
          maximumFractionDigits: 1,
          signDisplay: "exceptZero",
        }).format(gainShare);
  const gainNote =
    m.worthCents === null
      ? t("noValues")
      : m.gainCents === null
        ? t("valuedNote", { count: m.valuedCount, total: stats.bottleCount })
        : t(m.gainCents >= 0 ? "gainNote" : "lossNote", {
            amount: money(Math.abs(m.gainCents)),
            count: m.comparedCount,
          });
  const gainTone = m.gainCents !== null && m.gainCents < 0 ? "text-danger" : "text-ok";

  // The timeline: the wines whose windows are most pressing, on one shared axis.
  const generated = new Date(stats.generatedAt);
  const nowYear = generated.getUTCFullYear();
  const now =
    nowYear +
    (Date.UTC(nowYear, generated.getUTCMonth(), generated.getUTCDate()) - Date.UTC(nowYear, 0, 1)) /
      (365 * 86_400_000);
  // A rough window the table is unsure about is not drawn: a bar ending before "today" would say "past it".
  const windows: TimelineRow[] = cellar
    .flatMap((i) =>
      i.drink.from !== null && i.drink.until !== null && !i.drink.uncertain
        ? [{ item: i, from: i.drink.from, until: i.drink.until }]
        : [],
    )
    .sort(
      (a, b) =>
        a.item.drink.urgency - b.item.drink.urgency ||
        a.item.wineName.localeCompare(b.item.wineName),
    )
    .slice(0, TIMELINE_ROWS)
    .map(({ item, from, until }) => ({
      key: item.vintageId,
      href: `/cellar/${item.vintageId}`,
      name: item.wineName,
      vintage: formatVintage(item.year),
      type: item.type,
      producer: item.producer,
      from,
      until,
      phaseLabel: tDrink(`phase.${item.drink.phase}`),
      colour: PHASE_COLOUR[item.drink.phase],
      range: tDrink("window", { from, until }),
    }));

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="stat-tiles">
        <Tile big label={t("bottles")} value={String(stats.bottleCount)} />
        <Tile big label={t("wines")} value={String(stats.wineCount)} />
        <Tile
          label={t("spent")}
          value={m.spentCents === null ? "–" : money(m.spentCents)}
          note={m.spentCents === null ? t("noPrices") : t("pricedNote", { count: m.pricedCount })}
        />
        <Tile
          label={t("worth")}
          value={m.worthCents === null ? "–" : money(m.worthCents)}
          note={gainNote}
          noteClassName={m.gainCents === null ? undefined : gainTone}
        />
      </dl>

      <div className="mt-6 flex flex-col gap-4">
        {stats.bottleCount > 0 && (
          <Card title={t("drinkTitle")}>
            <div
              role="img"
              aria-label={`${t("drinkNow")}: ${byPhase.map((p) => `${p.label} ${p.count}`).join(", ")}`}
              className="flex h-3.5 gap-[3px]"
            >
              {byPhase.map((p) => (
                <span
                  key={p.key}
                  className="min-w-1.5 basis-0 rounded-full"
                  style={{ flexGrow: p.count, background: p.colour }}
                />
              ))}
            </div>
            <ul aria-label={t("drinkNow")} className="mt-4 grid grid-cols-2 gap-2.5">
              {byPhase.map((p) => (
                <li
                  key={p.key}
                  className={`rounded-[16px] p-3.5 last:odd:col-span-2 ${STAGE_TILE[p.key]}`}
                >
                  <span className="flex items-center gap-2 text-caption font-medium">
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: p.colour }}
                    />
                    {p.label}
                  </span>
                  <span className="mt-2 flex items-baseline gap-1.5">
                    <span className="font-display text-headline leading-none text-ink tnum">
                      {p.count}
                    </span>
                    <span className="text-caption lowercase text-ink-2">{t("bottles")}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-caption text-ink-2">{tDrink("estimate")}</p>
          </Card>
        )}

        {windows.length > 0 && (
          <Card title={t("windowsTitle")} aside={t("windowsNote", { count: windows.length })}>
            <WindowTimeline
              label={t("windowsTitle")}
              rows={windows}
              now={now}
              todayLabel={tDrink("today")}
            />
          </Card>
        )}

        {stats.bottleCount > 0 && anyReady && (
          <Card title={t("readyByYear")}>
            <Columns
              label={t("readyByYear")}
              highlight={0}
              partColour={PHASE_COLOUR.peak}
              columns={stats.readyByYear.map((y) => ({
                key: String(y.year),
                label: String(y.year).slice(2),
                value: y.ready,
                part: y.peak,
                text: t("yearText", { year: y.year, ready: y.ready, peak: y.peak }),
              }))}
            />
            <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-caption text-ink-2">
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-[3px]"
                  style={{ background: "color-mix(in srgb, var(--accent) 40%, transparent)" }}
                />
                {t("inWindow")}
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-[3px]"
                  style={{ background: PHASE_COLOUR.peak }}
                />
                {tDrink("phase.peak")}
              </li>
            </ul>
            <p className="mt-3 text-caption text-ink-2">{t("readyByYearNote")}</p>
          </Card>
        )}

        {/* With every bottle opened there is nothing to divide: no empty ring. */}
        {typeRows.some((r) => r.count > 0) && (
          <Card title={t("typesTitle")}>
            <Donut
              label={t("typesTitle")}
              chartLabel={typeSummary}
              unit={t("bottles")}
              rows={typeRows}
            />
          </Card>
        )}

        {m.worthCents !== null && (
          <Card title={t("valueTitle")}>
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
              <span className="font-display text-display leading-none text-ink tnum">
                {money(m.worthCents)}
              </span>
              {gainText !== null && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ring-1 ring-current/35 tnum ${gainTone}`}
                >
                  {gainText}
                </span>
              )}
            </p>
            <p className={`mt-2 text-small ${m.gainCents === null ? "text-ink-2" : gainTone}`}>
              {gainNote}
            </p>
            {stats.valueByMonth.length > 1 && (
              <div className="mt-5">
                <SubTitle>{t("valueOverTime")}</SubTitle>
                <ValueLine
                  label={t("valueOverTime")}
                  points={stats.valueByMonth}
                  format={money}
                  monthLabel={(month) =>
                    new Intl.DateTimeFormat(locale, {
                      month: "short",
                      year: "2-digit",
                      timeZone: "UTC",
                    }).format(new Date(`${month}-01T00:00:00Z`))
                  }
                />
                <p className="mt-2 text-caption text-ink-2">{t("valueOverTimeNote")}</p>
              </div>
            )}
            {comparable && m.spentCents !== null && (
              <div className="mt-5">
                <BarList
                  stacked
                  label={t("valueTitle")}
                  rows={[
                    {
                      key: "spent",
                      label: t("spent"),
                      count: m.spentCents,
                      text: money(m.spentCents),
                      colour: "color-mix(in srgb, var(--ink-3) 70%, transparent)",
                    },
                    {
                      key: "worth",
                      label: t("worth"),
                      count: m.worthCents,
                      text: money(m.worthCents),
                    },
                  ]}
                />
              </div>
            )}
          </Card>
        )}

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
                <SubTitle>{t("regions")}</SubTitle>
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
            <SubTitle>{t("decades")}</SubTitle>
            <BarList
              label={t("decades")}
              rows={stats.byDecade.map((x) => ({
                key: x.key,
                label: decade(x.key),
                count: x.count,
              }))}
            />
            <SubTitle>{t("producers")}</SubTitle>
            <BarList
              label={t("producers")}
              rows={stats.byProducer.map((x) => ({ key: x.key, label: x.key, count: x.count }))}
            />
          </Card>
        )}

        <Card title={t("drankTitle")}>
          {anyOpened ? (
            <Columns
              label={t("openedByMonth")}
              highlight={stats.openedByMonth.length - 1}
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
              {stats.topRated.map((r, i) => (
                <li key={r.vintageId} className="relative flex items-center gap-3 py-3">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-raised font-display text-title leading-none text-ink-2 tnum"
                  >
                    {i + 1}
                  </span>
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
                  <Stars score={r.stars * 2} label={t("starsOf", { stars: r.stars })} size={14} />
                </li>
              ))}
            </ol>
            {stats.ratingByType.length > 1 && (
              <>
                <SubTitle>{t("ratingByType")}</SubTitle>
                <BarList
                  label={t("ratingByType")}
                  max={5}
                  rows={stats.ratingByType.map((x) => ({
                    key: x.type,
                    label: tTypes(x.type),
                    count: x.stars,
                    colour: wineFill(x.type),
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

function Card({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card bg-surface p-4 shadow-raised ring-1 ring-hairline">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[1.5rem] leading-7 text-ink">{title}</h2>
        {aside && <span className="shrink-0 text-caption text-ink-3">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 mt-6 text-caption font-medium uppercase tracking-[0.14em] text-bronze">
      {children}
    </h3>
  );
}

function Tile({
  label,
  value,
  note,
  noteClassName,
  big = false,
}: {
  label: string;
  value: string;
  note?: string;
  noteClassName?: string | undefined;
  big?: boolean;
}) {
  return (
    <div className="flex flex-col-reverse justify-end rounded-card bg-surface p-4 shadow-raised ring-1 ring-hairline">
      <dt className="mt-2 text-small text-ink-2">
        {label}
        {note && (
          <span className={`mt-0.5 block text-caption ${noteClassName ?? "text-ink-2"}`}>
            {note}
          </span>
        )}
      </dt>
      <dd
        className={`font-display leading-none text-ink tnum ${big ? "text-display" : "text-headline"}`}
      >
        {value}
      </dd>
    </div>
  );
}
