import Link from "next/link";
import { ViewTransition } from "react";
import { useTranslations } from "next-intl";
import { formatVintage, type CellarItem } from "@cellr/domain";
import { BottleGlyph, type WineTint } from "@/ui/bottle-glyph";
import { cn } from "@/ui/cn";
import { FavoriteButton } from "./favorite-button";
import { imageUrl, LabelImage } from "./label-image";
import { DrinkLabel, DrinkWindowMini } from "./drink-bits";
import { RatingBadge } from "./tasting-bits";
import { SwipeFavorite } from "./swipe-favorite";
import { labelMark, placeLine, shapeFor } from "./wine-visuals";

interface ItemProps {
  item: CellarItem;
  locale: string;
}

/** The stage behind a bottle: a pastel field on paper, a soft glow on noir. */
export const STAGE: Record<WineTint, string> = {
  red: "bg-stage-red",
  white: "bg-stage-white",
  rose: "bg-stage-rose",
  sparkling: "bg-stage-sparkling",
  orange: "bg-stage-orange",
  dessert: "bg-stage-dessert",
  fortified: "bg-stage-fortified",
};

/** The wine's bottle: its own straightened label when there is one, otherwise typeset from the producer. */
export function ItemBottle({ item, className }: { item: CellarItem; className?: string }) {
  return (
    <BottleGlyph
      shape={shapeFor(item.type)}
      tint={item.type}
      mark={labelMark(item.producer, item.wineName)}
      year={formatVintage(item.year)}
      labelUrl={item.image?.texture ? imageUrl(item.image.id, "texture") : undefined}
      {...(className ? { className } : {})}
    />
  );
}

/** "Wine fridge", "Wine fridge +1", or "No place yet" — one short line, never a data table. */
function usePlaces(item: CellarItem) {
  const t = useTranslations("cellar");
  const [first, ...rest] = item.places;
  if (!first) return t("noPlace");
  const label = rest.length > 0 ? `${first} +${rest.length}` : first;
  return item.unplaced > 0 ? `${label} · ${t("notPlaced", { count: item.unplaced })}` : label;
}

function CountBadge({ count }: { count: number }) {
  const t = useTranslations("cellar");
  return (
    <span className="rounded-full bg-surface px-2.5 py-1 text-caption font-semibold text-ink shadow-raised tnum">
      <span aria-hidden="true">×{count}</span>
      <span className="sr-only">{t("bottlesLabel", { count })}</span>
    </span>
  );
}

/** Grid tile: the bottle on its stage is the hero, text stays small and calm. */
export function WineCard({ item, locale }: ItemProps) {
  const places = usePlaces(item);
  const where = placeLine(item.region, item.countryCode, locale);
  return (
    <article className="relative flex h-full flex-col rounded-card bg-surface p-2 shadow-raised ring-1 ring-hairline transition-transform duration-150 ease-cellr active:scale-[0.985]">
      {/* Named, so opening the wine grows this very stage into the wine page's hero. */}
      <ViewTransition name={`wine-${item.vintageId}`}>
        <div
          className={cn(
            "relative flex h-44 items-end justify-center overflow-hidden rounded-[16px]",
            STAGE[item.type],
          )}
        >
          {item.image ? (
            // The person's own label photo is the picture; the bottle sprite is for wines without one.
            <LabelImage image={item.image} size="thumb" className="absolute inset-0 size-full" />
          ) : (
            <>
              <span
                aria-hidden="true"
                className="absolute -bottom-10 left-1/2 size-36 -translate-x-1/2 rounded-full bg-surface/45"
              />
              <ItemBottle item={item} className="relative mb-1 w-[3.1rem]" />
            </>
          )}
          <span className="absolute left-2 top-2">
            <CountBadge count={item.count} />
          </span>
          <FavoriteButton
            wineId={item.wineId}
            wine={`${item.producer} ${item.wineName}`}
            favorite={item.favorite}
            className="absolute right-0 top-0 m-1 size-9 bg-surface/85"
          />
          {item.rating && <RatingBadge rating={item.rating} className="absolute bottom-2 left-2" />}
        </div>
      </ViewTransition>
      <div className="mt-3 flex-1 px-1.5">
        <p className="truncate text-caption font-medium uppercase tracking-[0.12em] text-bronze">
          {item.producer}
        </p>
        <h3 className="mt-0.5 line-clamp-2 font-display text-title text-ink">
          <Link
            href={`/cellar/${item.vintageId}`}
            className="after:absolute after:inset-0 after:rounded-card"
          >
            {item.wineName}
          </Link>
        </h3>
        <p className="mt-1 text-small text-ink-2">
          <span className="tnum">{formatVintage(item.year)}</span>
          {where && <span> · {where}</span>}
        </p>
      </div>
      <div className="mt-3 px-1.5 pb-1">
        <DrinkWindowMini drink={item.drink} />
        <p className="mt-2 flex items-center justify-between gap-2 text-caption text-ink-3">
          <span className="truncate">{places}</span>
          <DrinkLabel drink={item.drink} />
        </p>
      </div>
    </article>
  );
}

/** Compact row for people who like to see more at once. */
export function WineRow({ item, locale }: ItemProps) {
  const places = usePlaces(item);
  const where = placeLine(item.region, item.countryCode, locale);
  return (
    <SwipeFavorite wineId={item.wineId} favorite={item.favorite}>
      <article className="relative flex min-h-[4.5rem] items-center gap-4 px-1 py-3 active:bg-raised">
        {item.image ? (
          <LabelImage
            image={item.image}
            size="thumb"
            className="size-12 shrink-0 rounded-control"
          />
        ) : (
          <ItemBottle item={item} className="w-6 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-caption font-medium uppercase tracking-[0.12em] text-bronze">
            {item.producer}
          </p>
          <h3 className="truncate font-display text-title text-ink">
            <Link href={`/cellar/${item.vintageId}`} className="after:absolute after:inset-0">
              {item.wineName}
            </Link>
          </h3>
          <p className="truncate text-small text-ink-2">
            <span className="tnum">{formatVintage(item.year)}</span>
            {where && <span> · {where}</span>}
            {item.rating && <RatingBadge rating={item.rating} inline />}
          </p>
        </div>
        <FavoriteButton
          wineId={item.wineId}
          wine={`${item.producer} ${item.wineName}`}
          favorite={item.favorite}
          className="shrink-0"
        />
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <CountBadge count={item.count} />
          <p className="max-w-[9rem] truncate text-caption text-ink-3">{places}</p>
          <DrinkLabel drink={item.drink} />
        </div>
      </article>
    </SwipeFavorite>
  );
}
