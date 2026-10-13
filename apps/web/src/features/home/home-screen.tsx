import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import {
  formatStars,
  formatVintage,
  type CellarItem,
  type HomeView,
  type OpenedEntry,
  type Reminder,
  reminderWhen,
} from "@cellr/domain";
import { Greeting } from "@/features/account/greeting";
import { shapeFor } from "@/features/cellar/wine-visuals";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { buttonStyles } from "@/ui/button";
import { ChevronRightIcon, PlusIcon } from "@/ui/icons";
import { Stars } from "@/ui/stars";
import { EmptyState } from "@/ui/empty-state";
import { DrinkLabel } from "@/features/cellar/drink-bits";
import { QuickRate } from "./quick-rate";

/** "yesterday", "3 days ago", in the viewer's language. */
function whenOpened(iso: string, locale: string, now: number): string {
  const days = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
  if (days >= 60) {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  }
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
}

/**
 * Home: a greeting, the one big question ("what shall we drink tonight?"), then your cellar at a glance —
 * how much there is, what arrived, what was opened, how much room is left.
 */
export async function HomeScreen({
  home,
  name,
  reminders = [],
}: {
  home: HomeView;
  name: string | null;
  /** Bottles being kept for a day that is coming up. */
  reminders?: readonly Reminder[];
}) {
  const t = await getTranslations("home");
  const locale = await getLocale();
  const empty = home.bottleCount === 0;
  const now = Date.parse(home.generatedAt);

  const money = (cents: number) => {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: home.currency ?? "EUR",
        maximumFractionDigits: 0,
      }).format(cents / 100);
    } catch {
      return String(Math.round(cents / 100));
    }
  };
  const free = home.capacity - home.used;
  // A bottle opened in the last three days that you have not said anything about: ask while it is fresh.
  const toRate = home.recentlyOpened.find(
    (o) => !o.rated && now - Date.parse(o.openedAt) < 3 * 86_400_000,
  );

  return (
    <div className="pt-10 lg:pt-14">
      <h1 className="font-display text-headline text-ink-2">
        <Greeting name={name} />
      </h1>

      {/* The one big question. Everything else on Home is secondary to it. */}
      <Link
        href="/tonight"
        className="group relative mt-6 block overflow-hidden rounded-card border border-hairline bg-surface p-6 transition-transform duration-200 ease-cellr active:scale-[0.99] md:p-8"
      >
        <p className="text-caption font-medium uppercase tracking-[0.18em] text-bronze">
          {t("heroEyebrow")}
        </p>
        <h2 className="mt-3 max-w-[14ch] font-display text-display text-balance md:max-w-[18ch]">
          {t("heroTitle")}
        </h2>
        <p className="mt-3 max-w-[17rem] text-body text-ink-2">
          {empty ? t("heroEmpty") : t("heroFilled")}
        </p>
        <span className="mt-6 inline-flex items-center gap-1 text-small font-medium text-accent-fg">
          {t("heroCta")}
          <ChevronRightIcon
            size={18}
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </span>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-6 right-5 flex items-end gap-2 opacity-70 md:right-10"
        >
          <BottleGlyph shape="bordeaux" tint="red" className="w-8 -rotate-6 md:w-10" />
          <BottleGlyph shape="burgundy" tint="white" className="w-9 md:w-11" />
        </div>
      </Link>

      {toRate && (
        <section
          className="mt-6 rounded-card border border-hairline bg-surface p-5"
          aria-labelledby="rate-nudge"
          data-testid="rate-nudge"
        >
          <h2 id="rate-nudge" className="font-display text-title">
            {t("nudge", { wine: toRate.wineName })}
          </h2>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <QuickRate bottleId={toRate.bottleId} />
            <Link
              href={`/cellar/${toRate.vintageId}?rate=${toRate.bottleId}`}
              className="inline-flex min-h-11 items-center text-small font-medium text-accent-fg"
            >
              {t("nudgeNote")}
            </Link>
          </div>
        </section>
      )}

      <nav aria-label={t("shortcuts")} className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { href: "/scan", label: t("shortcutScan") },
          { href: "/sommelier", label: t("shortcutSommelier") },
          { href: "/wishlist", label: t("shortcutWishlist") },
          { href: "/insights", label: t("shortcutInsights") },
        ].map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="flex min-h-14 items-center justify-center rounded-card border border-hairline bg-surface px-2 py-3 text-center text-small font-medium text-ink transition-transform duration-150 ease-cellr active:scale-[0.98]"
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {empty ? (
        <EmptyState
          className="mt-6"
          title={t("emptyTitle")}
          body={t("emptyBody")}
          action={
            <Link href="/cellar/add" className={buttonStyles({ variant: "primary", size: "lg" })}>
              {t("addBottle")}
            </Link>
          }
        />
      ) : (
        <>
          <dl className="mt-6 grid grid-cols-3 gap-3" data-testid="home-stats">
            <Stat label={t("statBottles")} value={String(home.bottleCount)} />
            <Stat label={t("statWines")} value={String(home.wineCount)} />
            {home.valueCents !== null ? (
              <Stat
                label={t("statValue")}
                value={money(home.valueCents)}
                note={t("statValueNote", { count: home.pricedCount })}
              />
            ) : (
              <Stat label={t("statFree")} value={home.capacity > 0 ? String(free) : "–"} />
            )}
          </dl>

          {reminders.length > 0 && (
            <section className="mt-10" aria-labelledby="coming-up">
              <SectionHeader id="coming-up" title={t("comingUp")} />
              <ul
                className="divide-y divide-hairline rounded-card border border-hairline bg-surface px-4"
                data-testid="reminders"
              >
                {reminders.map((r) => {
                  const when = reminderWhen(r.daysUntil);
                  return (
                    <li key={r.bottleId}>
                      <article className="relative flex min-h-16 items-center gap-4 py-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-display text-title text-ink">
                            <Link
                              href={`/cellar/${r.vintageId}`}
                              className="after:absolute after:inset-0"
                            >
                              {r.title}
                            </Link>
                          </h3>
                          <p className="truncate text-small text-ink-2">
                            {r.wineName} · <span className="tnum">{formatVintage(r.year)}</span>
                          </p>
                        </div>
                        <p
                          className={
                            when === "overdue"
                              ? "text-small font-medium text-danger"
                              : "text-small font-medium text-accent-fg"
                          }
                        >
                          {t(`reminder.${when}`, { days: Math.abs(r.daysUntil) })}
                        </p>
                      </article>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {home.drinkSoon.length > 0 && (
            <section className="mt-10" aria-labelledby="soon">
              <SectionHeader id="soon" title={t("drinkSoon")} />
              <ul className="divide-y divide-hairline rounded-card border border-hairline bg-surface px-4">
                {home.drinkSoon.map((item) => (
                  <li key={item.vintageId}>
                    <article className="relative flex min-h-16 items-center gap-4 py-3">
                      <BottleGlyph
                        shape={shapeFor(item.type)}
                        tint={item.type}
                        className="w-4 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-display text-title text-ink">
                          <Link
                            href={`/cellar/${item.vintageId}`}
                            className="after:absolute after:inset-0"
                          >
                            {item.wineName}
                          </Link>
                        </h3>
                        <p className="truncate text-small text-ink-2">
                          {item.producer} · <span className="tnum">{formatVintage(item.year)}</span>
                        </p>
                      </div>
                      <DrinkLabel drink={item.drink} className="text-small" />
                    </article>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-10" aria-labelledby="added">
            <SectionHeader id="added" title={t("recentlyAdded")}>
              <Link
                href="/cellar"
                className="inline-flex min-h-11 items-center gap-1 text-small font-medium text-accent-fg"
              >
                {t("seeAll")}
                <ChevronRightIcon size={16} />
              </Link>
            </SectionHeader>
            <ul className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-2 md:mx-0 md:px-0">
              {home.recentlyAdded.map((item) => (
                <li key={item.vintageId} className="snap-start">
                  <MiniCard item={item} />
                </li>
              ))}
            </ul>
          </section>

          {home.recentlyOpened.length > 0 && (
            <section className="mt-10" aria-labelledby="opened">
              <SectionHeader id="opened" title={t("openedLately")} />
              <ul className="divide-y divide-hairline rounded-card border border-hairline bg-surface px-4">
                {home.recentlyOpened.map((o) => (
                  <li key={o.bottleId}>
                    <OpenedRow
                      entry={o}
                      when={whenOpened(o.openedAt, locale, now)}
                      rateLabel={t("rateIt")}
                      starsLabel={
                        o.myScore === null ? "" : t("ratedStars", { stars: formatStars(o.myScore) })
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-10" aria-labelledby="space">
            <SectionHeader id="space" title={t("space")} />
            <div className="rounded-card border border-hairline bg-surface p-5">
              {home.capacity > 0 ? (
                <>
                  <p className="text-body text-ink">
                    {t("spaceUsed", { used: home.used, capacity: home.capacity })}
                  </p>
                  <div
                    role="meter"
                    aria-label={t("space")}
                    aria-valuemin={0}
                    aria-valuemax={home.capacity}
                    aria-valuenow={home.used}
                    className="mt-3 h-2 overflow-hidden rounded-full bg-raised"
                  >
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.min(100, (home.used / home.capacity) * 100)}%` }}
                    />
                  </div>
                </>
              ) : (
                <p className="text-body text-ink-2">{t("spaceNone")}</p>
              )}
              {home.unplaced > 0 && (
                <p className="mt-3 text-small text-ink-2">
                  {t("unplaced", { count: home.unplaced })}
                </p>
              )}
            </div>
          </section>

          <div className="mt-10 grid grid-cols-2 gap-3 sm:flex">
            <Link
              href="/cellar/add"
              className={buttonStyles({ variant: "primary", size: "lg", className: "sm:min-w-52" })}
            >
              <PlusIcon size={20} />
              {t("addBottle")}
            </Link>
            <Link
              href="/cellar"
              className={buttonStyles({
                variant: "secondary",
                size: "lg",
                className: "sm:min-w-52",
              })}
            >
              {t("openCellar")}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function SectionHeader({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 id={id} className="text-caption font-medium uppercase tracking-[0.18em] text-ink-2">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  // Reads "Bottles, 4" for a screen reader; shows the number first, big, with the label under it.
  return (
    <div className="flex flex-col-reverse justify-end rounded-card border border-hairline bg-surface p-4">
      <dt className="mt-2 text-small text-ink-2">
        {label}
        {note && <span className="mt-0.5 block text-caption">{note}</span>}
      </dt>
      <dd className="font-display text-display leading-none tnum">{value}</dd>
    </div>
  );
}

function MiniCard({ item }: { item: CellarItem }) {
  return (
    <article className="relative flex w-36 flex-col rounded-card border border-hairline bg-surface p-3 shadow-raised transition-transform duration-150 ease-cellr active:scale-[0.985]">
      <div className="grid h-24 place-items-center rounded-control bg-raised">
        <BottleGlyph shape={shapeFor(item.type)} tint={item.type} className="h-[4.5rem] w-auto" />
      </div>
      <p className="mt-3 truncate text-caption font-medium uppercase tracking-[0.12em] text-ink-3">
        {item.producer}
      </p>
      <h3 className="line-clamp-2 min-h-[2.75rem] font-display text-title leading-snug text-ink">
        <Link
          href={`/cellar/${item.vintageId}`}
          className="after:absolute after:inset-0 after:rounded-card"
        >
          {item.wineName}
        </Link>
      </h3>
      <p className="mt-1 text-small text-ink-2 tnum">{formatVintage(item.year)}</p>
    </article>
  );
}

function OpenedRow({
  entry,
  when,
  rateLabel,
  starsLabel,
}: {
  entry: OpenedEntry;
  when: string;
  rateLabel: string;
  starsLabel: string;
}) {
  return (
    <article className="relative flex min-h-16 items-center gap-4 py-3">
      <BottleGlyph shape={shapeFor(entry.type)} tint={entry.type} className="w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-display text-title text-ink">
          <Link href={`/cellar/${entry.vintageId}`} className="after:absolute after:inset-0">
            {entry.wineName}
          </Link>
        </h3>
        <p className="truncate text-small text-ink-2">
          {entry.producer} · <span className="tnum">{formatVintage(entry.year)}</span>
        </p>
      </div>
      <div className="relative z-10 flex shrink-0 flex-col items-end gap-1">
        <p className="text-small text-ink-2">{when}</p>
        {entry.myScore !== null ? (
          <Stars score={entry.myScore} label={starsLabel} size={14} />
        ) : !entry.rated ? (
          <Link
            href={`/cellar/${entry.vintageId}?rate=${entry.bottleId}`}
            className="inline-flex min-h-8 items-center text-small font-medium text-accent-fg"
          >
            {rateLabel}
          </Link>
        ) : null}
      </div>
    </article>
  );
}
