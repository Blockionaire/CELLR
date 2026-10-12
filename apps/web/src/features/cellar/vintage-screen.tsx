"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import {
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
import { useExtras } from "@/features/insights/hooks";
import { InsightCard } from "@/features/insights/insight-card";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { Stars } from "@/ui/stars";
import { Button, buttonStyles } from "@/ui/button";
import { ChevronRightIcon, PlusIcon } from "@/ui/icons";
import { BottleSpot, useDay, useMoney } from "./bottle-bits";
import { DrinkLabel } from "./drink-bits";
import { DrinkChart } from "./drink-chart";
import { EditSheet } from "./edit-sheet";
import { FavoriteButton } from "./favorite-button";
import { LabelImage } from "./label-image";
import { LabelPhotoActions } from "./label-photo-actions";
import { useVintage } from "./hooks";
import { MoveBottleSheet } from "./move-bottle-sheet";
import { NewPlaceSheet } from "./new-place-sheet";
import { OpenBottleSheet } from "./open-bottle-sheet";
import { RateSheet } from "./rate-sheet";
import { TastingItem } from "./tasting-bits";
import { placeLine, shapeFor } from "./wine-visuals";

type SheetName = "open" | "move" | "edit" | "place" | null;

/**
 * One vintage of one wine. The wine comes first (name, producer, year, region), then how many you
 * own and where, then what you paid and what is known about it. The three things you do with a
 * bottle — open, move, edit — are right under the title.
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

  return (
    <div className="mx-auto w-full max-w-3xl pt-6 lg:pt-10">
      <Link
        href="/cellar"
        className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-control px-2 text-small font-medium text-ink-2 transition-colors hover:text-ink"
      >
        <ChevronRightIcon size={18} className="rotate-180" />
        {t("back")}
      </Link>

      <header className="mt-2 grid gap-6 md:grid-cols-[13rem_1fr] md:items-center">
        <div>
          <div className="relative grid h-56 place-items-center overflow-hidden rounded-card bg-raised md:h-64">
            {detail.image ? (
              <LabelImage
                image={detail.image}
                size="photo"
                alt={tPhoto("alt", { wine: `${wine.producer} ${wine.name}` })}
                className="absolute inset-0 size-full"
              />
            ) : (
              <BottleGlyph
                shape={shapeFor(wine.type)}
                tint={wine.type}
                className="h-44 w-auto md:h-52"
                title={tTypes(wine.type)}
              />
            )}
          </div>
          <LabelPhotoActions vintageId={detail.vintageId} side="front" image={detail.image} />
        </div>
        <div className="min-w-0">
          <p className="text-caption font-medium uppercase tracking-[0.14em] text-ink-3">
            {wine.producer}
          </p>
          <div className="mt-1 flex items-start justify-between gap-2">
            <h1 className="font-display text-display text-balance">{wine.name}</h1>
            <FavoriteButton
              wineId={wine.id}
              wine={`${wine.producer} ${wine.name}`}
              favorite={wine.favorite}
              className="-mr-2 shrink-0"
              size={26}
            />
          </div>
          <p className="mt-2 text-title text-ink-2">
            <span className="tnum">{formatVintage(detail.year)}</span>
            {where && <span> · {where}</span>}
          </p>
          <p className="mt-3 inline-flex items-center gap-2 text-small text-ink-2">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ background: `var(--wine-${wine.type})` }}
            />
            {tTypes(wine.type)}
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
            {count > 0 ? (
              <Button size="lg" onClick={() => setSheet("open")} className="col-span-2 sm:min-w-48">
                {t("open")}
              </Button>
            ) : (
              <Link
                href={addMoreHref}
                className={buttonStyles({
                  variant: "primary",
                  size: "lg",
                  className: "col-span-2",
                })}
              >
                <PlusIcon size={20} />
                {t("addMore")}
              </Link>
            )}
            {count > 0 && (
              <Button variant="secondary" size="lg" onClick={() => setSheet("move")}>
                {t("move")}
              </Button>
            )}
            <Button
              variant="secondary"
              size="lg"
              onClick={() => setSheet("edit")}
              className={count === 0 ? "col-span-2 sm:col-span-1" : ""}
            >
              {t("edit")}
            </Button>
          </div>
        </div>
      </header>

      <div className="mt-10 flex flex-col gap-4">
        <Section>
          {count > 0 ? (
            <>
              <p className="flex items-baseline gap-3">
                <span className="font-display text-display tnum" data-testid="bottle-count">
                  {count}
                </span>
                <span className="text-body text-ink-2">{t("bottlesInCellar", { count })}</span>
              </p>
              <p className="mt-3 text-small text-ink-2">
                {places.map((p, i) => (
                  <span key={p.label ?? "none"}>
                    {i > 0 && " · "}
                    {p.label ?? t("notPlaced")} <span className="tnum">×{p.count}</span>
                  </span>
                ))}
              </p>
              {count > 1 && (
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
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
              <ul className="mt-4 divide-y divide-hairline" aria-label={t("bottlesTitle")}>
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

        <Section title={tDrink("title")}>
          <p className="flex items-center gap-2 font-display text-headline">
            <DrinkLabel drink={detail.drink} className="text-headline text-ink [&>span]:size-3" />
            {detail.drink.phase === "unknown" && tDrink("phase.unknown")}
          </p>
          <p className="mt-2 text-body text-ink-2" data-testid="drink-explain">
            {tDrink(`explain.${detail.drink.phase}`, {
              years: Math.max(1, Math.ceil(detail.drink.yearsUntilOpen ?? 1)),
            })}
          </p>
          <DrinkChart drink={detail.drink} year={detail.year} opened={detail.opened} />
          <p className="mt-4 text-caption text-ink-2">{tDrink("estimate")}</p>
        </Section>

        <Section title={tPhoto("backTitle")}>
          <div className="flex items-start gap-4">
            {detail.backImage && (
              <LabelImage
                image={detail.backImage}
                size="thumb"
                alt={tPhoto("backAlt", { wine: `${wine.producer} ${wine.name}` })}
                className="h-28 w-auto rounded-control bg-raised"
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

        <InsightCard vintageId={detail.vintageId} currency={detail.currency ?? currency} />

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

        <Section title={t("about")}>
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
            <ol className="flex flex-col gap-3">
              {history.map((e) => (
                <li
                  key={`${e.kind}-${e.day}`}
                  className="flex items-baseline justify-between gap-4"
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
          title={`${wine.name} ${formatVintage(detail.year)}`}
          existing={extrasOf(extrasFor.id)}
        />
      )}
      <EditSheet open={sheet === "edit"} onClose={() => setSheet(null)} detail={detail} />
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
          title={`${wine.name} ${formatVintage(detail.year)}`}
          existing={mine(rating.id)}
        />
      )}
    </div>
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

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-hairline bg-surface p-5">
      {title && (
        <h2 className="mb-3 text-caption font-medium uppercase tracking-[0.18em] text-ink-3">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: ReadonlyArray<readonly [string, string]> }) {
  return (
    <dl className="flex flex-col gap-3">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt className="text-small text-ink-2">{label}</dt>
          <dd className="text-right text-body text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
