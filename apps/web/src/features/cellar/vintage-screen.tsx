"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import {
  currentValueCents,
  formatVintage,
  historyEvents,
  summarizePlaces,
  summarizeScores,
  type BottleExtrasView,
  type BottleView,
  type VintageDetail,
} from "@cellr/domain";
import { BulkBar } from "./bulk-bottles";
import { BottleExtrasSheet } from "@/features/insights/bottle-extras-sheet";
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
import { Facts, Section, Tag } from "./vintage-bits";
import { AboutSection, WorthSection } from "./wine-insight";
import { placeLine, shapeFor, labelMark } from "./wine-visuals";
import { STAGE } from "./wine-card";

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
}: {
  initial: VintageDetail;
  currency: string;
  /** An opened bottle to talk about straight away (a link from Home: "rate it"). */
  initialRate?: string | undefined;
}) {
  const t = useTranslations("vintage");
  const tTasting = useTranslations("tasting");
  const tDrink = useTranslations("drink");
  const tTypes = useTranslations("wineTypes");
  const tPhoto = useTranslations("photo");
  const tInsights = useTranslations("insights");
  const locale = useLocale();
  const { data: detail } = useVintage(initial.vintageId, initial);
  const [sheet, setSheet] = useState<SheetName>(null);
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

  return (
    <div className="mx-auto w-full max-w-3xl pb-28 pt-4 lg:pb-0 lg:pt-10">
      <header className="grid gap-6 md:grid-cols-[19rem_1fr] md:items-start md:gap-8">
        <div>
          <div
            className={cn(
              "relative isolate flex h-72 items-end justify-center overflow-hidden rounded-[28px] md:h-80",
              STAGE[wine.type],
            )}
          >
            {detail.image ? (
              <LabelImage
                image={detail.image}
                size="photo"
                alt={tPhoto("alt", { wine: `${wine.producer} ${wine.name}` })}
                className="absolute inset-0 size-full"
              />
            ) : (
              <>
                {/* The year, big and faint behind the bottle. Drawn from an attribute so it is no text to read or to check. */}
                <span
                  aria-hidden="true"
                  data-year={vintageName}
                  className="pointer-events-none absolute inset-x-0 top-[8%] select-none text-center font-display text-[9rem] leading-none text-ink/[0.07] before:content-[attr(data-year)]"
                />
                <span
                  aria-hidden="true"
                  className="absolute -bottom-20 left-1/2 size-72 -translate-x-1/2 rounded-full bg-surface/45"
                />
                <BottleGlyph
                  shape={shapeFor(wine.type)}
                  tint={wine.type}
                  mark={labelMark(wine.producer, wine.name)}
                  year={vintageName}
                  className="relative mb-11 h-56 w-auto md:h-64"
                  title={tTypes(wine.type)}
                />
              </>
            )}

            <Link
              href="/cellar"
              aria-label={t("back")}
              className="absolute left-3 top-3 z-10 grid size-11 place-items-center rounded-full bg-surface/85 text-ink shadow-raised transition-transform duration-150 ease-cellr active:scale-[0.96]"
            >
              <ChevronRightIcon size={20} className="rotate-180" />
            </Link>
            <FavoriteButton
              wineId={wine.id}
              wine={`${wine.producer} ${wine.name}`}
              favorite={wine.favorite}
              className="absolute right-3 top-3 size-11 bg-surface/85"
              size={22}
            />

            <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
              {phase !== "unknown" ? (
                <PhasePill phase={phase} className="shadow-raised" />
              ) : (
                <span />
              )}
              {count > 0 && (
                <span className="rounded-full bg-surface px-3 py-1 text-caption font-semibold text-ink shadow-raised tnum">
                  {t("heroCount", { count })}
                </span>
              )}
            </div>
          </div>
          <LabelPhotoActions vintageId={detail.vintageId} side="front" image={detail.image} />
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

          <div
            role="group"
            aria-label={t("actions")}
            className="fixed inset-x-0 bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom))] z-20 border-t border-hairline bg-canvas/90 backdrop-blur-xl lg:static lg:z-auto lg:mt-6 lg:border-0 lg:bg-transparent lg:backdrop-blur-none"
          >
            <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-5 py-3 md:px-8 lg:max-w-none lg:p-0">
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
                  <StarIcon size={22} strokeWidth={1.75} />
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

      {cells.length >= 2 && (
        <div
          className={cn(
            "mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-card bg-hairline shadow-raised ring-1 ring-hairline",
            cells.length === 3 ? "sm:grid-cols-3" : cells.length === 4 ? "sm:grid-cols-4" : "",
          )}
        >
          {cells.map((cell) => (
            <div
              key={cell.key}
              className="min-w-0 bg-surface p-4 max-sm:[&:last-child:nth-child(odd)]:col-span-2"
            >
              <p className="font-display text-headline break-words tnum text-ink">{cell.value}</p>
              <p className="mt-1 text-caption text-ink-2">{cell.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-10 flex flex-col gap-9">
        <Section
          title={tDrink("title")}
          action={
            <span className="rounded-full border border-hairline px-2.5 py-0.5 text-caption font-medium text-bronze">
              {tDrink("estimateBadge")}
            </span>
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PhasePill phase={phase} />
            {yearsLeft !== null && (
              <span className="text-small text-ink-2">
                {tDrink("yearsLeft", { years: yearsLeft })}
              </span>
            )}
          </div>
          <DrinkChart drink={detail.drink} year={detail.year} opened={detail.opened} />
          <p
            className="mt-4 font-display text-title italic text-balance text-ink"
            data-testid="drink-explain"
          >
            {tDrink(`explain.${phase}`, {
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
          <Button
            className="mt-4 -ml-3"
            size="sm"
            variant="ghost"
            onClick={() => setSheet("merge")}
          >
            {t("merge")}
          </Button>
        </AboutSection>

        <Section title={t("bottlesTitle")}>
          {count > 0 ? (
            <>
              <ul className="flex flex-wrap gap-2">
                {places.map((p, i) => (
                  <Tag key={p.label ?? "none"} last={i === places.length - 1}>
                    {p.label ?? t("notPlaced")} <span className="tnum">×{p.count}</span>
                  </Tag>
                ))}
              </ul>
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
              <ul className="mt-2 divide-y divide-hairline" aria-label={t("bottlesTitle")}>
                {detail.bottles.map((b) => (
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
                        <BottleSpot bottle={b} short={places.length <= 1} />
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      {b.priceCents !== null && (
                        <span className="text-small text-ink-2 tnum">{money(b.priceCents)}</span>
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
            </>
          ) : (
            <>
              <p className="font-display text-headline">{t("noneLeft")}</p>
              <p className="mt-1 text-body text-ink-2">{t("noneLeftBody")}</p>
            </>
          )}
        </Section>

        <WorthSection vintageId={detail.vintageId} currency={detail.currency ?? currency} />

        {count > 0 && (
          <Section title={t("purchase")}>
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
          </Section>
        )}

        <Section title={tPhoto("backTitle")}>
          <div className="flex items-start gap-4">
            {detail.backImage && (
              <LabelImage
                image={detail.backImage}
                size="thumb"
                alt={tPhoto("backAlt", { wine: `${wine.producer} ${wine.name}` })}
                className="h-28 w-auto rounded-[16px] bg-raised"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-body text-ink-2">
                {detail.backImage ? tPhoto("backHave") : tPhoto("backBody")}
              </p>
              <LabelPhotoActions
                vintageId={detail.vintageId}
                side="back"
                image={detail.backImage}
              />
            </div>
          </div>
        </Section>

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

        {history.length > 0 && (
          <Section title={t("history")}>
            <ol className="flex flex-col divide-y divide-hairline">
              {history.map((e) => (
                <li
                  key={`${e.kind}-${e.day}`}
                  className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
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
      className="inline-flex size-14 shrink-0 select-none items-center justify-center gap-2 rounded-full border border-hairline bg-surface text-ink shadow-raised transition-[transform,background-color] duration-150 ease-cellr hover:bg-raised active:scale-[0.98] lg:w-auto lg:px-5"
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
