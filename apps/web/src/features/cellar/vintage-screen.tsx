"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import {
  currentValueCents,
  formatVintage,
  historyEvents,
  groupBottlesByPlace,
  summarizePlaces,
  summarizeScores,
  type BottleExtrasView,
  type BottleView,
  type VintageDetail,
} from "@cellr/domain";
import { BulkBar } from "./bulk-bottles";
import { BottleExtrasSheet } from "@/features/insights/bottle-extras-sheet";
import { RecommendButton } from "@/features/friends/recommend-sheet";
import { useExtras, useInsight } from "@/features/insights/hooks";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { Stars } from "@/ui/stars";
import { Button, buttonStyles } from "@/ui/button";
import { cn } from "@/ui/cn";
import { ChevronRightIcon, PlusIcon, StarIcon } from "@/ui/icons";
import { BottleSpot, useDay, useMoney } from "./bottle-bits";
import { DrinkChart, PhasePill } from "./drink-chart";
import { EditSheet } from "./edit-sheet";
import { FavoriteButton } from "./favorite-button";
import { LabelImage } from "./label-image";
import { LabelPhotoActions } from "./label-photo-actions";
import { useVintage } from "./hooks";
import { MoveBottleSheet } from "./move-bottle-sheet";
import { MergeWineSheet } from "./merge-wine-sheet";
import { NewPlaceSheet } from "./new-place-sheet";
import { OpenBottleSheet } from "./open-bottle-sheet";
import { RateSheet } from "./rate-sheet";
import { TastingItem } from "./tasting-bits";
import { Facts, Section } from "./vintage-bits";
import { AboutSection, PairsSection, TasteSection, WorthSection } from "./wine-insight";
import { placeLine, shapeFor } from "./wine-visuals";
import { WinePicture } from "./wine-picture";

type SheetName = "open" | "move" | "edit" | "place" | "merge" | null;

/**
 * One vintage of one wine, as a page with a hero: the bottle on its stage with how ready it is and how many you
 * own, then the title, a strip of the numbers that matter, when to drink it, what is known about the wine, the
 * bottles and where they are, what it is worth and cost, its photos, and its history. The things you do with a
 * bottle (open, move, rate, edit) sit in one bar: pinned above the bottom navigation on a phone.
 */
export function VintageScreen({
  initial,
  currency,
  initialRate,
  initialPick = false,
}: {
  initial: VintageDetail;
  currency: string;
  /** An opened bottle to talk about straight away (a link from Home: "rate it"). */
  initialRate?: string | undefined;
  /** Came here to take a bottle out (Tonight's "take this bottle"): the open sheet is up, easiest bottle first. */
  initialPick?: boolean;
}) {
  const t = useTranslations("vintage");
  const tTasting = useTranslations("tasting");
  const tDrink = useTranslations("drink");
  const tTypes = useTranslations("wineTypes");
  const tPhoto = useTranslations("photo");
  const tInsights = useTranslations("insights");
  const locale = useLocale();
  const { data: detail } = useVintage(initial.vintageId, initial);
  const [sheet, setSheet] = useState<SheetName>(() =>
    initialPick && initial.bottles.length > 0 ? "open" : null,
  );
  const [rating, setRating] = useState<BottleView | null>(
    () => initial.opened.find((b) => b.id === initialRate) ?? null,
  );
  const [extrasFor, setExtrasFor] = useState<BottleView | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const tBulk = useTranslations("bulk");
  const stopSelecting = () => {
    setSelecting(false);
    setPicked([]);
  };
  const tExtras = useTranslations("bottleExtras");
  const extras = useExtras(initial.vintageId);
  const extrasOf = (bottleId: string) => extras.data?.items.find((e) => e.bottleId === bottleId);
  const insight = useInsight(initial.vintageId);
  const money = useMoney(detail.currency ?? currency);
  const day = useDay();

  const { wine } = detail;
  const count = detail.bottles.length;
  const places = summarizePlaces(detail.bottles);
  const history = historyEvents([...detail.bottles, ...detail.opened]);
  const latestPurchase = detail.bottles
    .flatMap((b) => (b.purchasedAt ? [b.purchasedAt] : []))
    .sort()
    .at(-1);
  const mine = (bottleId: string) =>
    detail.tastings.find((x) => x.mine && x.bottleId === bottleId) ?? null;
  const summary = summarizeScores(
    detail.tastings.flatMap((x) => (x.score === null ? [] : [x.score])),
  );
  const earlier = detail.tastings.filter(
    (x) => x.bottleId === null || !detail.opened.some((b) => b.id === x.bottleId),
  );
  const where = placeLine(wine.region, wine.countryCode, locale);
  const addMoreHref = `/cellar/add?wine=${wine.id}${detail.year === null ? "&nv=1" : `&year=${detail.year}`}`;
  const phase = detail.drink.phase;
  const vintageName = formatVintage(detail.year);

  // The bottle to talk about from the bar: the newest opened one nobody (you) has rated yet, else the newest.
  const rateTarget = detail.opened.find((b) => mine(b.id) === null) ?? detail.opened[0] ?? null;

  // Real numbers only: what the household owns, where, what it paid, and (when known) what it is worth now.
  const worthCents = insight.data?.ready ? currentValueCents(insight.data) : null;
  const averageCents = detail.averagePriceCents;
  const delta =
    worthCents !== null && averageCents !== null && averageCents > 0
      ? (worthCents - averageCents) / averageCents
      : null;
  const placeValue =
    places.length === 0
      ? ""
      : places.length === 1
        ? (places[0]!.label ?? t("notPlaced"))
        : `${places[0]!.label ?? t("notPlaced")} +${places.length - 1}`;
  const cells: Array<{ key: string; value: ReactNode; label: ReactNode }> = [];
  if (count > 0) {
    cells.push(
      {
        key: "bottles",
        value: <span data-testid="bottle-count">{count}</span>,
        label: t("factBottles", { count }),
      },
      { key: "where", value: placeValue, label: t("where") },
    );
  }
  if (averageCents !== null) {
    cells.push({ key: "average", value: money(averageCents), label: t("factAverage") });
  }
  if (worthCents !== null) {
    cells.push({
      key: "worth",
      value: money(worthCents),
      label: (
        <>
          {tInsights("valueTitle")}{" "}
          {delta !== null && Math.round(delta * 100) !== 0 && (
            <span className={cn("font-semibold tnum", delta > 0 ? "text-ok" : "text-danger")}>
              {new Intl.NumberFormat(locale, {
                style: "percent",
                signDisplay: "exceptZero",
                maximumFractionDigits: 0,
              }).format(delta)}
            </span>
          )}
        </>
      ),
    });
  }
  const yearsLeft =
    detail.drink.yearsLeft !== null &&
    (phase === "developing" || phase === "peak" || phase === "ready") &&
    Math.round(detail.drink.yearsLeft) >= 1
      ? Math.round(detail.drink.yearsLeft)
      : null;

  const phrase = [
    placeValue || null,
    averageCents !== null ? t("factAveragePhrase", { price: money(averageCents) }) : null,
  ].filter(Boolean);

  // Everything that would complete the page but is not there yet, gathered in one quiet place.
  const missingFront = !detail.image;
  const missingBack = !detail.backImage;
  const missingWorth = insight.data?.ready === true && worthCents === null;

  return (
    <div className="mx-auto w-full max-w-3xl pb-28 pt-3 lg:pb-0 lg:pt-10">
      <header className="grid gap-5 md:grid-cols-[20rem_1fr] md:items-end md:gap-9">
        <div className="relative">
          <WinePicture
            wine={{
              vintageId: detail.vintageId,
              type: wine.type,
              producer: wine.producer,
              wineName: wine.name,
              year: detail.year,
              image: detail.image,
            }}
            size="photo"
            shared
            year
            alt={tPhoto("alt", { wine: `${wine.producer} ${wine.name}` })}
            className="h-[22rem] rounded-[28px] shadow-raised ring-1 ring-hairline [--year-size:9rem] md:h-[26rem]"
            bottleClassName="h-[76%]"
          />

          <Link
            href="/cellar"
            aria-label={t("back")}
            className="absolute left-3 top-3 z-10 grid size-11 place-items-center rounded-full bg-surface/85 text-ink shadow-raised backdrop-blur-sm transition-transform duration-200 ease-spring active:scale-[0.92]"
          >
            <ChevronRightIcon size={20} className="rotate-180" />
          </Link>
          <FavoriteButton
            wineId={wine.id}
            wine={`${wine.producer} ${wine.name}`}
            favorite={wine.favorite}
            className="absolute right-3 top-3 z-10 size-11 bg-surface/85 backdrop-blur-sm"
            size={22}
          />
          <RecommendButton
            vintageId={detail.vintageId}
            wine={`${wine.producer} ${wine.name} ${vintageName}`}
            className="absolute right-3 top-16 z-10 size-11 bg-surface/85 backdrop-blur-sm"
          />
          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
            {phase !== "unknown" && !detail.drink.uncertain ? (
              <PhasePill phase={phase} className="shadow-raised" />
            ) : (
              <span />
            )}
            {count > 0 && (
              <span
                key={count}
                className="pop-in rounded-full bg-surface px-3 py-1 text-caption font-semibold text-ink shadow-raised tnum"
              >
                {t("heroCount", { count })}
              </span>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-caption font-medium uppercase tracking-[0.14em] text-bronze">
            {wine.producer}
          </p>
          <h1 className="mt-1 font-display text-display text-balance text-ink md:text-[3rem] md:leading-[1.05]">
            {wine.name}
          </h1>
          <p className="mt-2 text-title text-ink-2">
            <span className="tnum">{vintageName}</span>
            {where && <span> · {where}</span>}
          </p>
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink-2">
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-full"
                style={{ background: `var(--wine-${wine.type})` }}
              />
              {tTypes(wine.type)}
            </span>
            {summary && (
              <span className="inline-flex items-center gap-1.5 tnum">
                <StarIcon size={15} fill="currentColor" className="text-accent-fg" />
                {tTasting("ratingSummary", { average: summary.average, count: summary.count })}
              </span>
            )}
          </p>
          {/* The numbers that matter, as one line: how many, where, what they cost, what they are worth. */}
          <p className="mt-3 text-small text-ink tnum" data-testid="facts-line">
            {count > 0 && (
              <>
                <span
                  key={count}
                  data-testid="bottle-count"
                  className="pop-in inline-block font-semibold"
                >
                  {count}
                </span>{" "}
                {t("factBottles", { count })}
              </>
            )}
            {phrase.map((part, i) => (
              <span key={i}>
                {(count > 0 || i > 0) && <span className="text-ink-3"> · </span>}
                {part}
              </span>
            ))}
            {worthCents !== null && (
              <span>
                <span className="text-ink-3"> · </span>
                {t("factWorthPhrase", { price: money(worthCents) })}
                {delta !== null && Math.round(delta * 100) !== 0 && (
                  <span className={cn("ml-1 font-semibold", delta > 0 ? "text-ok" : "text-danger")}>
                    {new Intl.NumberFormat(locale, {
                      style: "percent",
                      signDisplay: "exceptZero",
                      maximumFractionDigits: 0,
                    }).format(delta)}
                  </span>
                )}
              </span>
            )}
          </p>

          <div
            role="group"
            aria-label={t("actions")}
            className="fixed inset-x-0 bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom))] z-20 border-t border-hairline bg-canvas/90 backdrop-blur-xl lg:static lg:z-auto lg:mt-6 lg:border-0 lg:bg-transparent lg:backdrop-blur-none"
          >
            <div className="mx-auto flex max-w-3xl items-center gap-2 px-5 py-3 md:px-8 lg:max-w-none lg:p-0">
              {count > 0 ? (
                <Button size="lg" onClick={() => setSheet("open")} className="min-w-0 flex-1">
                  {t("open")}
                </Button>
              ) : (
                <Link
                  href={addMoreHref}
                  className={buttonStyles({
                    variant: "primary",
                    size: "lg",
                    className: "min-w-0 flex-1",
                  })}
                >
                  <PlusIcon size={20} />
                  {t("addMore")}
                </Link>
              )}
              {count > 0 && (
                <BarButton label={t("move")} onClick={() => setSheet("move")}>
                  <BarIcon>
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </BarIcon>
                </BarButton>
              )}
              {rateTarget && (
                <BarButton label={tTasting("ratingLabel")} onClick={() => setRating(rateTarget)}>
                  <StarIcon size={20} strokeWidth={1.75} />
                </BarButton>
              )}
              <BarButton label={t("edit")} onClick={() => setSheet("edit")}>
                <BarIcon>
                  <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
                  <path d="m13.5 6.5 3 3" />
                </BarIcon>
              </BarButton>
            </div>
          </div>
        </div>
      </header>

      <div className="mt-8 flex flex-col">
        <Section
          title={tDrink("title")}
          action={
            <span
              data-testid="drink-basis"
              className="rounded-full border border-hairline px-2.5 py-0.5 text-caption font-medium text-bronze"
            >
              {tDrink(`basis.${detail.drink.source}`)}
            </span>
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            {detail.drink.uncertain ? (
              <span
                data-testid="drink-uncertain"
                className="inline-flex items-center gap-1.5 rounded-full bg-raised px-3 py-1 text-caption font-semibold text-ink-2"
              >
                <span aria-hidden="true" className="size-2 rounded-full bg-ink-3" />
                {tDrink("uncertain")}
              </span>
            ) : (
              <PhasePill phase={phase} />
            )}
            {yearsLeft !== null && (
              <span className="text-small text-ink-2">
                {tDrink("yearsLeft", { years: yearsLeft })}
              </span>
            )}
          </div>
          {!detail.drink.uncertain && (
            <DrinkChart drink={detail.drink} year={detail.year} opened={detail.opened} />
          )}
          <p
            className="mt-4 font-display text-title italic text-balance text-ink"
            data-testid="drink-explain"
          >
            {detail.drink.uncertain
              ? tDrink("explainUncertain")
              : tDrink(`explain.${phase}`, {
                  years: Math.max(1, Math.ceil(detail.drink.yearsUntilOpen ?? 1)),
                })}
          </p>
          <p className="mt-3 text-caption text-ink-2">
            {tDrink(detail.drink.source === "ai" ? "estimateAi" : "estimate")}
          </p>
        </Section>

        <AboutSection vintageId={detail.vintageId} title={t("about")}>
          <Facts
            rows={[
              [t("style"), tTypes(wine.type)],
              ...(wine.region ? [[t("region"), wine.region] as [string, string]] : []),
              ...(wine.appellation
                ? [[t("appellation"), wine.appellation] as [string, string]]
                : []),
              ...(wine.countryCode
                ? [[t("country"), placeLine(null, wine.countryCode, locale)] as [string, string]]
                : []),
            ]}
          />
        </AboutSection>
        <TasteSection vintageId={detail.vintageId} />
        <PairsSection vintageId={detail.vintageId} />

        <Section title={t("bottlesTitle")}>
          {count > 0 ? (
            <>
              {count > 1 && (
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="-ml-3"
                    onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
                  >
                    {selecting ? tBulk("done") : tBulk("select")}
                  </Button>
                  {selecting && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setPicked(picked.length === count ? [] : detail.bottles.map((b) => b.id))
                      }
                    >
                      {picked.length === count ? tBulk("selectNone") : tBulk("selectAll")}
                    </Button>
                  )}
                </div>
              )}
              {selecting && <BulkBar detail={detail} selected={picked} onDone={stopSelecting} />}
              {/* Every bottle's exact spot, grouped by place; the bottles without a place last, said as such. */}
              <div className="mt-2 flex flex-col gap-4" data-testid="bottle-places">
                {groupBottlesByPlace(detail.bottles).map((group) => (
                  <section key={group.label ?? "none"} aria-label={group.label ?? t("notPlaced")}>
                    <h3 className="flex items-baseline justify-between gap-3 border-b border-hairline pb-1.5 text-caption font-medium uppercase tracking-[0.14em] text-bronze">
                      <span className="min-w-0 truncate">{group.label ?? t("notPlaced")}</span>
                      <span className="shrink-0 tnum">×{group.bottles.length}</span>
                    </h3>
                    <ul className="divide-y divide-hairline">
                      {group.bottles.map((b) => (
                        <li
                          key={b.id}
                          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3"
                        >
                          <span className="flex items-center gap-3 text-body text-ink">
                            {selecting && (
                              <input
                                type="checkbox"
                                checked={picked.includes(b.id)}
                                onChange={(e) =>
                                  setPicked((p) =>
                                    e.target.checked ? [...p, b.id] : p.filter((id) => id !== b.id),
                                  )
                                }
                                aria-label={tBulk("pick", {
                                  spot: b.locationLabel ?? tExtras("unplaced"),
                                })}
                                className="size-5 accent-[var(--accent)]"
                              />
                            )}
                            <BottleGlyph
                              shape={shapeFor(wine.type)}
                              tint={wine.type}
                              className="w-3 shrink-0"
                            />
                            <span>
                              <BottleSpot bottle={b} short />
                            </span>
                          </span>
                          <span className="flex items-center gap-3">
                            {b.priceCents !== null && (
                              <span className="text-small text-ink-2 tnum">
                                {money(b.priceCents)}
                              </span>
                            )}
                            {extras.data?.ready && (
                              <Button
                                size="sm"
                                variant="ghost"
                                aria-label={tExtras("editLabel", {
                                  spot: b.locationLabel ?? tExtras("unplaced"),
                                })}
                                onClick={() => setExtrasFor(b)}
                              >
                                {tExtras("edit")}
                              </Button>
                            )}
                          </span>
                          <BottleChips extras={extrasOf(b.id)} day={day} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              <div className="mt-4 border-t border-hairline pt-4">
                <h3 className="sr-only">{t("purchase")}</h3>
                <Facts
                  rows={[
                    [
                      t("averagePrice"),
                      detail.averagePriceCents === null
                        ? t("notRecorded")
                        : money(detail.averagePriceCents),
                    ],
                    [t("latestPurchase"), latestPurchase ? day(latestPurchase) : t("notRecorded")],
                  ]}
                />
              </div>
            </>
          ) : (
            <>
              <p className="font-display text-headline">{t("noneLeft")}</p>
              <p className="mt-1 text-body text-ink-2">{t("noneLeftBody")}</p>
            </>
          )}
        </Section>

        {!missingWorth && (
          <WorthSection vintageId={detail.vintageId} currency={detail.currency ?? currency} />
        )}

        {(detail.opened.length > 0 || detail.tastings.length > 0) && (
          <Section title={tTasting("sectionTitle")}>
            {summary && (
              <p className="mb-4 flex items-center gap-2 text-body text-ink">
                <Stars
                  score={Math.round(summary.average * 2)}
                  label={tTasting("rated", { stars: summary.average })}
                />
                <span data-testid="rating-summary">
                  {tTasting("ratingSummary", { average: summary.average, count: summary.count })}
                </span>
              </p>
            )}
            <ul className="flex flex-col gap-5">
              {detail.opened.map((b) => {
                const here = detail.tastings.filter((x) => x.bottleId === b.id);
                return (
                  <li key={b.id} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-body text-ink">
                        {tTasting("openedOn", { day: b.openedAt ? day(b.openedAt) : "" })}
                      </p>
                      {mine(b.id) === null && (
                        <Button size="sm" variant="secondary" onClick={() => setRating(b)}>
                          {tTasting("howWasIt")}
                        </Button>
                      )}
                    </div>
                    {here.map((x) => (
                      <TastingItem
                        key={x.id}
                        tasting={x}
                        onEdit={x.mine ? () => setRating(b) : undefined}
                      />
                    ))}
                  </li>
                );
              })}
              {earlier.length > 0 && (
                <li className="flex flex-col gap-2">
                  <p className="text-small font-medium text-ink-2">{tTasting("earlierNotes")}</p>
                  {earlier.map((x) => (
                    <TastingItem key={x.id} tasting={x} />
                  ))}
                </li>
              )}
            </ul>
          </Section>
        )}

        {!missingFront || !missingBack ? (
          <Section title={tPhoto("labelsTitle")}>
            <div className="flex flex-col gap-5">
              {!missingFront && (
                <div>
                  <p className="text-small text-ink-2">{tPhoto("frontHave")}</p>
                  <LabelPhotoActions
                    vintageId={detail.vintageId}
                    side="front"
                    image={detail.image}
                  />
                </div>
              )}
              {!missingBack && (
                <div className="flex items-start gap-4">
                  <LabelImage
                    image={detail.backImage!}
                    size="thumb"
                    alt={tPhoto("backAlt", { wine: `${wine.producer} ${wine.name}` })}
                    className="h-28 w-auto rounded-[16px] bg-raised"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-body text-ink-2">{tPhoto("backHave")}</p>
                    <LabelPhotoActions
                      vintageId={detail.vintageId}
                      side="back"
                      image={detail.backImage}
                    />
                  </div>
                </div>
              )}
            </div>
          </Section>
        ) : null}

        {history.length > 0 && (
          <Section title={t("history")}>
            <ol className="flex flex-col divide-y divide-hairline">
              {history.map((e) => (
                <li
                  key={`${e.kind}-${e.day}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="text-body text-ink">
                    {e.kind === "added"
                      ? t("historyAdded", { count: e.count })
                      : t("historyOpened", { count: e.count })}
                  </span>
                  <span className="text-small text-ink-3 tnum">{day(e.day)}</span>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {/* Completing the page: everything that could still be added, folded away so it never interrupts. */}
        <details
          className="group/more mt-2 border-t border-hairline py-5"
          data-testid="complete-wine"
          open={missingFront || undefined}
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block font-display text-headline text-ink">
                {t("completeTitle")}
              </span>
              <span className="block text-small text-ink-2">{t("completeHint")}</span>
            </span>
            <ChevronRightIcon
              size={20}
              className="shrink-0 rotate-90 text-ink-3 transition-transform duration-300 ease-spring group-open/more:-rotate-90"
            />
          </summary>
          <div className="mt-4 flex flex-col gap-6">
            {missingFront && (
              <div>
                <p className="text-body text-ink">{tPhoto("frontTitle")}</p>
                <p className="text-small text-ink-2">{tPhoto("frontBody")}</p>
                <LabelPhotoActions vintageId={detail.vintageId} side="front" image={null} />
              </div>
            )}
            {missingBack && (
              <div>
                <p className="text-body text-ink">{tPhoto("backTitle")}</p>
                <p className="text-small text-ink-2">{tPhoto("backBody")}</p>
                <LabelPhotoActions vintageId={detail.vintageId} side="back" image={null} />
              </div>
            )}
            {missingWorth && (
              <WorthSection
                vintageId={detail.vintageId}
                currency={detail.currency ?? currency}
                bare
              />
            )}
            <div>
              <p className="text-body text-ink">{t("mergeTitle")}</p>
              <p className="text-small text-ink-2">{t("mergeBody")}</p>
              <Button
                className="mt-2"
                size="sm"
                variant="secondary"
                onClick={() => setSheet("merge")}
              >
                {t("merge")}
              </Button>
            </div>
          </div>
        </details>
      </div>

      <OpenBottleSheet open={sheet === "open"} onClose={() => setSheet(null)} detail={detail} />
      <MoveBottleSheet
        open={sheet === "move"}
        onClose={() => setSheet(null)}
        detail={detail}
        onNewPlace={() => setSheet("place")}
      />
      {extrasFor && (
        <BottleExtrasSheet
          key={extrasFor.id}
          open
          onClose={() => setExtrasFor(null)}
          vintageId={detail.vintageId}
          bottleId={extrasFor.id}
          title={`${wine.name} ${vintageName}`}
          existing={extrasOf(extrasFor.id)}
        />
      )}
      <EditSheet open={sheet === "edit"} onClose={() => setSheet(null)} detail={detail} />
      <MergeWineSheet open={sheet === "merge"} onClose={() => setSheet(null)} detail={detail} />
      <NewPlaceSheet
        open={sheet === "place"}
        onClose={() => setSheet("move")}
        onCreated={() => undefined}
      />
      {rating && (
        <RateSheet
          key={`${rating.id}-${mine(rating.id)?.id ?? "new"}-${mine(rating.id)?.score ?? ""}`}
          open
          onClose={() => setRating(null)}
          bottleId={rating.id}
          title={`${wine.name} ${vintageName}`}
          existing={mine(rating.id)}
        />
      )}
    </div>
  );
}

/** A round secondary action in the bar: an icon on a phone, icon and word on a wide screen. */
function BarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-12 shrink-0 select-none items-center justify-center gap-2 rounded-full bg-raised text-ink-2 transition-[transform,background-color,color] duration-200 ease-spring hover:text-ink active:scale-[0.92] lg:h-14 lg:w-auto lg:px-5"
    >
      {children}
      <span className="hidden text-small font-medium lg:inline">{label}</span>
    </button>
  );
}

function BarIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** "A gift from Oma · Keeping it for Christmas dinner · 25 Dec 2026" under a bottle. */
function BottleChips({
  extras,
  day,
}: {
  extras: BottleExtrasView | undefined;
  day: (iso: string) => string;
}) {
  const t = useTranslations("bottleExtras");
  if (!extras) return null;
  const chips = [
    extras.acquiredHow === "gift"
      ? extras.giftFrom
        ? t("chipGiftFrom", { name: extras.giftFrom })
        : t("chipGift")
      : extras.acquiredHow === "bought"
        ? t("chipBought")
        : null,
    extras.occasionTitle
      ? extras.occasionOn
        ? t("chipOccasionOn", { title: extras.occasionTitle, day: day(extras.occasionOn) })
        : t("chipOccasion", { title: extras.occasionTitle })
      : null,
  ].filter((c): c is string => c !== null);
  if (chips.length === 0) return null;
  return (
    <p className="basis-full pl-6 text-small text-ink-2" data-testid="bottle-chips">
      {chips.join(" · ")}
    </p>
  );
}
