import Link from "next/link";
import { InsightsEntry } from "@/features/stats/insights-entry";
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
import { DrinkLabel } from "@/features/cellar/drink-bits";
import { WinePicture } from "@/features/cellar/wine-picture";
import { FriendRequestsBanner } from "@/features/friends/entry";
import { buttonStyles } from "@/ui/button";
import { cn } from "@/ui/cn";
import { EmptyState } from "@/ui/empty-state";
import { ChevronRightIcon, StarIcon } from "@/ui/icons";
import { Stars } from "@/ui/stars";
import { ReviewNudge } from "./review-nudge";

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

/** Three of tonight's questions, one tap from Home: each opens Tonight already asking it. */
const QUICK = ["steak", "pasta", "celebrate"] as const;

/**
 * Home, in four parts: tonight (the reason to open the app), the bottles at their best, what just arrived, and
 * one personal note (what was opened lately). Anything that needs an answer now (rate last night's bottle, a
 * friend request, a bottle kept for a day that is coming) appears above, and only then.
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
  const tTonight = await getTranslations("tonight");
  const locale = await getLocale();
  const empty = home.bottleCount === 0;
  const now = Date.parse(home.generatedAt);

  // A bottle opened in the last three days that you have not said anything about: ask while it is fresh.
  const toRate = home.recentlyOpened.find(
    (o) => !o.rated && now - Date.parse(o.openedAt) < 3 * 86_400_000,
  );
  // What to open: the urgent ones first (their own window says so), then those at their best.
  const best = [
    ...home.drinkSoon,
    ...home.atPeak.filter((p) => !home.drinkSoon.some((s) => s.vintageId === p.vintageId)),
  ].slice(0, 8);
  // The hero shows a few of the person's own bottles: their photos first, the likely candidates first.
  const heroWines = [...best, ...home.recentlyAdded]
    .filter((w, i, all) => all.findIndex((x) => x.vintageId === w.vintageId) === i)
    .sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image)))
    .slice(0, 3);
  const money =
    home.valueCents === null
      ? null
      : (() => {
          try {
            return new Intl.NumberFormat(locale, {
              style: "currency",
              currency: home.currency ?? "EUR",
              maximumFractionDigits: 0,
            }).format(home.valueCents / 100);
          } catch {
            return null;
          }
        })();

  return (
    <div className="pt-8 lg:pt-14">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <h1 className="font-display text-[2.1rem] leading-[2.4rem] text-ink">
          <Greeting name={name} />
        </h1>
      </header>

      <TonightHero
        eyebrow={t("heroEyebrow")}
        title={t("heroTitle")}
        body={empty ? t("heroEmpty") : t("heroFilled")}
        cta={t("heroCta")}
        quick={empty ? [] : QUICK.map((q) => tTonight(`chatChips.${q}`))}
        wines={heroWines}
        quickLabel={t("quickAsk")}
      />

      {/* The collection in one line, under Tonight: the way into Insights (it used to sit beside the greeting). */}
      {!empty && (
        <InsightsEntry
          subtle
          className="mt-3"
          testId="home-summary"
          summary={
            <>
              {t("summary", { bottles: home.bottleCount, wines: home.wineCount })}
              {money && <span> · {money}</span>}
            </>
          }
        />
      )}

      {toRate && <ReviewNudge entry={toRate} when={whenOpened(toRate.openedAt, locale, now)} />}

      <FriendRequestsBanner />

      {/* The way to Ratings: what I have rated so far, one tap from Home (once there is something to rate). */}
      {(home.myRatings?.wines ?? 0) > 0 ? (
        <Link
          href="/ratings"
          data-testid="home-ratings"
          className="mt-6 flex items-center gap-4 rounded-card bg-surface p-5 shadow-raised ring-1 ring-hairline transition-transform duration-150 ease-cellr active:scale-[0.99]"
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-raised text-accent-fg">
            <StarIcon size={22} fill="currentColor" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-title text-ink">{t("ratingsTitle")}</span>
            <span className="mt-0.5 block text-small text-ink-2 tnum">
              {t("ratingsSummary", {
                count: home.myRatings!.wines,
                average: home.myRatings!.average?.toFixed(1) ?? "—",
              })}
            </span>
          </span>
          <ChevronRightIcon size={20} className="shrink-0 text-ink-3" />
        </Link>
      ) : (
        home.recentlyOpened.length > 0 && (
          <Link
            href="/ratings"
            data-testid="home-ratings"
            className="mt-6 flex items-center justify-between gap-3 rounded-card bg-surface px-5 py-4 ring-1 ring-hairline"
          >
            <span className="text-body text-ink">{t("ratingsStart")}</span>
            <ChevronRightIcon size={20} className="shrink-0 text-ink-3" />
          </Link>
        )
      )}

      {reminders.length > 0 && (
        <section className="mt-10" aria-labelledby="coming-up">
          <SectionHeader id="coming-up" title={t("comingUp")} />
          <ul className="flex flex-col gap-1" data-testid="reminders">
            {reminders.map((r) => {
              const when = reminderWhen(r.daysUntil);
              return (
                <li key={r.bottleId}>
                  <article className="relative flex min-h-14 items-center gap-4 rounded-[16px] px-1 py-2 transition-colors duration-150 hover:bg-raised/60">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-title text-ink">
                        <Link
                          href={`/cellar/${r.vintageId}`}
                          className="after:absolute after:inset-0"
                        >
                          {r.title}
                        </Link>
                      </h3>
                      <p className="text-small text-ink-2">
                        {r.wineName} · <span className="tnum">{formatVintage(r.year)}</span>
                      </p>
                    </div>
                    <p
                      className={cn(
                        "shrink-0 text-small font-medium",
                        when === "overdue" ? "text-danger" : "text-accent-fg",
                      )}
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

      {empty ? (
        <EmptyState
          className="mt-8"
          title={t("emptyTitle")}
          body={t("emptyBody")}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/scan" className={buttonStyles({ variant: "primary", size: "lg" })}>
                {t("emptyAction")}
              </Link>
              <Link
                href="/cellar/add"
                className={buttonStyles({ variant: "secondary", size: "lg" })}
              >
                {t("addBottle")}
              </Link>
            </div>
          }
        />
      ) : (
        <>
          {best.length > 0 && (
            <Shelf id="best" title={t("atPeak")}>
              {best.map((item, i) => (
                <ShelfCard key={item.vintageId} item={item} index={i} status />
              ))}
            </Shelf>
          )}

          <Shelf
            id="added"
            title={t("recentlyAdded")}
            more={
              <Link
                href="/cellar"
                className="inline-flex min-h-11 items-center gap-1 text-small font-medium text-accent-fg"
              >
                {t("seeAll")}
                <ChevronRightIcon size={16} />
              </Link>
            }
          >
            {home.recentlyAdded.map((item, i) => (
              <ShelfCard
                key={item.vintageId}
                item={item}
                index={i}
                // one picture per wine carries the morph into its page
                shared={!best.some((b) => b.vintageId === item.vintageId)}
              />
            ))}
          </Shelf>
        </>
      )}

      {/* Also with every bottle drunk: what was opened lately (and still waiting for a word) stays in view. */}
      {home.recentlyOpened.length > 0 && (
        <section className="mt-10" aria-labelledby="opened">
          <SectionHeader id="opened" title={t("openedLately")} />
          <ul className="flex flex-col gap-1">
            {home.recentlyOpened.slice(0, 3).map((o) => (
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
    </div>
  );
}

/**
 * The one big question, in the deep wine colour of both themes: the person's own bottles fanned out beside it,
 * three questions to start with, and the way in.
 */
function TonightHero({
  eyebrow,
  title,
  body,
  cta,
  quick,
  quickLabel,
  wines,
}: {
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  quick: string[];
  quickLabel: string;
  wines: CellarItem[];
}) {
  return (
    <section
      aria-labelledby="tonight-title"
      data-testid="tonight-hero"
      className="group/hero relative mt-6 overflow-hidden rounded-[28px] bg-hero text-hero-ink shadow-raised"
    >
      {/* candlelight: a warm glow in the corner where the bottles stand */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-[radial-gradient(closest-side,rgb(227_194_133/0.32),transparent)]"
      />
      <Link href="/tonight" className="relative block p-6 pb-5 md:p-8 md:pb-6">
        <p className="text-caption font-medium uppercase tracking-[0.18em] text-hero-gold">
          {eyebrow}
        </p>
        <h2
          id="tonight-title"
          className="mt-3 max-w-[10ch] font-display text-[2.25rem] leading-[2.4rem] text-balance md:max-w-[16ch] md:text-[3rem] md:leading-[1.02]"
        >
          {title}
        </h2>
        <p className="mt-3 max-w-[12.5rem] text-small text-hero-ink/80 md:max-w-xs md:text-body">
          {body}
        </p>
        <span className="mt-5 inline-flex h-11 items-center gap-1 rounded-full bg-hero-gold px-5 text-small font-semibold text-[#3a1119] transition-transform duration-200 ease-spring group-active/hero:scale-[0.97]">
          {cta}
          <ChevronRightIcon
            size={18}
            className="transition-transform duration-200 ease-spring group-hover/hero:translate-x-0.5"
          />
        </span>
        <HeroFan wines={wines} />
      </Link>
      {quick.length > 0 && (
        <nav
          aria-label={quickLabel}
          className="relative -mt-1 flex gap-2 overflow-x-auto px-6 pb-6 scrollbar-none md:px-8 md:pb-8"
        >
          {quick.map((q) => (
            <Link
              key={q}
              href={`/tonight?ask=${encodeURIComponent(q)}`}
              className="inline-flex h-9 shrink-0 items-center rounded-full bg-white/10 px-4 text-small text-hero-ink ring-1 ring-white/15 backdrop-blur-sm transition-[transform,background-color] duration-200 ease-spring hover:bg-white/15 active:scale-[0.96]"
            >
              {q}
            </Link>
          ))}
        </nav>
      )}
    </section>
  );
}

/** Up to three of the person's own bottles, fanned like cards in a hand; they open a little on hover. */
function HeroFan({ wines }: { wines: CellarItem[] }) {
  const placed =
    wines.length === 0
      ? []
      : wines.length === 1
        ? [{ w: wines[0]!, rot: 0, x: 0 }]
        : wines.length === 2
          ? [
              { w: wines[1]!, rot: -8, x: -16 },
              { w: wines[0]!, rot: 5, x: 6 },
            ]
          : [
              { w: wines[2]!, rot: -12, x: -26 },
              { w: wines[1]!, rot: 10, x: 16 },
              { w: wines[0]!, rot: -1, x: -4 },
            ];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -right-3 top-9 h-[7.5rem] w-[5.5rem] min-[420px]:right-4 min-[420px]:h-32 min-[420px]:w-24 md:right-14 md:top-10 md:h-52 md:w-36"
    >
      {placed.length === 0 ? (
        <span className="absolute inset-0 rounded-[18px] bg-white/5 ring-1 ring-white/10" />
      ) : (
        placed.map(({ w, rot, x }, i) => (
          <span
            key={w.vintageId}
            style={
              {
                "--rot": `${rot}deg`,
                "--x": `${x}px`,
                "--i": i,
              } as React.CSSProperties
            }
            className="fan-card absolute inset-0 overflow-hidden rounded-[16px] shadow-[0_18px_30px_-12px_rgb(0_0_0/0.55)] ring-1 ring-white/15"
          >
            <WinePicture wine={w} className="size-full" />
          </span>
        ))
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
    <div className="mb-3 flex min-h-11 items-center justify-between gap-3">
      <h2 id={id} className="font-display text-headline text-ink">
        {title}
      </h2>
      {children}
    </div>
  );
}

/** A row of wines that scrolls sideways on a phone and wraps into a grid on a wide screen. */
function Shelf({
  id,
  title,
  more,
  children,
}: {
  id: string;
  title: string;
  more?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10" aria-labelledby={id}>
      <SectionHeader id={id} title={title}>
        {more}
      </SectionHeader>
      <ul className="-mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3.5 overflow-x-auto px-5 pb-2 scrollbar-none md:mx-0 md:grid md:snap-none md:grid-cols-4 md:gap-5 md:overflow-visible md:px-0 lg:grid-cols-5">
        {children}
      </ul>
    </section>
  );
}

/** A wine on a shelf: its picture is the card; the words sit quietly underneath. */
function ShelfCard({
  item,
  index,
  status = false,
  shared = false,
}: {
  item: CellarItem;
  index: number;
  /** Say how ready it is (only on the shelf about exactly that). */
  status?: boolean;
  shared?: boolean;
}) {
  return (
    <li
      className="reveal w-[8.75rem] shrink-0 snap-start md:w-auto"
      style={{ "--i": Math.min(index, 6) } as React.CSSProperties}
    >
      <article className="group/card relative">
        <WinePicture
          wine={item}
          shared={shared}
          className="aspect-[3/4] w-full rounded-[18px] shadow-raised ring-1 ring-hairline transition-transform duration-300 ease-spring group-hover/card:-translate-y-0.5 group-active/card:scale-[0.97]"
          bottleClassName="h-[80%]"
        />
        <p className="mt-2.5 truncate text-caption font-medium uppercase tracking-[0.12em] text-bronze">
          {item.producer}
        </p>
        <h3 className="mt-0.5 line-clamp-2 font-display text-title leading-snug text-ink">
          <Link
            href={`/cellar/${item.vintageId}`}
            className="after:absolute after:inset-0 after:rounded-[18px]"
          >
            {item.wineName}
          </Link>
        </h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-small text-ink-2">
          <span className="tnum">{formatVintage(item.year)}</span>
          {status && <DrinkLabel drink={item.drink} className="text-caption" />}
        </p>
      </article>
    </li>
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
    <article className="relative flex min-h-16 items-center gap-4 rounded-[16px] px-1 py-2 transition-colors duration-150 hover:bg-raised/60">
      <WinePicture
        wine={{ ...entry, image: null }}
        className="h-14 w-11 shrink-0 rounded-[10px]"
        bottleClassName="h-[84%]"
      />
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-title leading-snug text-ink">
          <Link href={`/cellar/${entry.vintageId}`} className="after:absolute after:inset-0">
            {entry.wineName}
          </Link>
        </h3>
        <p className="text-small text-ink-2">
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
