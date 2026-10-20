import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatVintage, placeSummary, type CellarItem } from "@cellr/domain";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { FavoriteButton } from "./favorite-button";
import { imageUrl } from "./label-image";
import { DrinkLabel } from "./drink-bits";
import { WinePicture } from "./wine-picture";
import { RatingBadge } from "./tasting-bits";
import { SwipeFavorite } from "./swipe-favorite";
import { labelMark, placeLine, shapeFor } from "./wine-visuals";

interface ItemProps {
  item: CellarItem;
  locale: string;
}

export { STAGE } from "./wine-visuals";

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

/**
 * "Wine fridge", "Wine fridge +1", or "No place yet": one short line, never a data table, and never one spot for
 * bottles that are spread out. The full list (bottles without a place included) is its title; the wine's page
 * has every exact spot.
 */
function usePlaces(item: CellarItem) {
  const t = useTranslations("cellar");
  const { first, more } = placeSummary(item.places, item.unplaced);
  const all = [
    ...item.places,
    ...(item.unplaced > 0 ? [t("notPlaced", { count: item.unplaced })] : []),
  ].join(", ");
  return { text: `${first ?? t("noPlace")}${more > 0 ? ` +${more}` : ""}`, all };
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

/**
 * Grid tile: the wine's picture is the card (its own label photo whenever there is one); beneath it, quietly,
 * who made it, its name in full, the year and where it is from, and how ready it is.
 */
export function WineCard({ item, locale, shared = false }: ItemProps & { shared?: boolean }) {
  const places = usePlaces(item);
  const where = item.region ?? placeLine(null, item.countryCode, locale);
  return (
    <article className="group/card relative flex h-full flex-col">
      <div className="relative">
        <WinePicture
          wine={item}
          shared={shared}
          className="aspect-[4/5] w-full rounded-[20px] shadow-raised ring-1 ring-hairline transition-transform duration-300 ease-spring group-hover/card:-translate-y-0.5 group-active/card:scale-[0.97]"
          bottleClassName="h-[80%]"
        />
        <span className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5">
          <CountBadge count={item.count} />
          {item.rating && <RatingBadge rating={item.rating} />}
        </span>
        <FavoriteButton
          wineId={item.wineId}
          wine={`${item.producer} ${item.wineName}`}
          favorite={item.favorite}
          className="absolute right-1 top-1 z-10 size-10 bg-surface/80 backdrop-blur-sm"
        />
      </div>

      <div className="mt-3 flex flex-1 flex-col px-0.5">
        <p className="line-clamp-2 text-caption font-medium uppercase tracking-[0.12em] text-bronze">
          {item.producer}
        </p>
        <h3 className="mt-0.5 line-clamp-3 font-display text-title leading-snug text-ink">
          <Link
            href={`/cellar/${item.vintageId}`}
            className="after:absolute after:inset-0 after:rounded-[20px]"
          >
            {item.wineName}
          </Link>
        </h3>
        <p className="mt-1 text-small text-ink-2">
          <span className="tnum">{formatVintage(item.year)}</span>
          {where && <span> · {where}</span>}
        </p>
        <DrinkLabel drink={item.drink} className="mt-1.5" />
        <p
          className="mt-1 truncate text-caption text-ink-3"
          title={places.all}
          data-testid="wine-places"
        >
          {places.text}
        </p>
      </div>
    </article>
  );
}

/** Compact row for people who like to see more at once. */
export function WineRow({ item, locale, shared = false }: ItemProps & { shared?: boolean }) {
  const places = usePlaces(item);
  const where = placeLine(item.region, item.countryCode, locale);
  return (
    <SwipeFavorite wineId={item.wineId} favorite={item.favorite}>
      <article className="relative flex min-h-[5.5rem] items-center gap-4 py-3 transition-colors duration-150 active:bg-raised">
        <WinePicture
          wine={item}
          shared={shared}
          className="h-[4.5rem] w-14 shrink-0 rounded-[12px] ring-1 ring-hairline"
          bottleClassName="h-[84%]"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-caption font-medium uppercase tracking-[0.12em] text-bronze">
            {item.producer}
          </p>
          <h3 className="line-clamp-2 font-display text-title leading-snug text-ink">
            <Link href={`/cellar/${item.vintageId}`} className="after:absolute after:inset-0">
              {item.wineName}
            </Link>
          </h3>
          <p className="text-small text-ink-2">
            <span className="tnum">{formatVintage(item.year)}</span>
            {where && <span> · {where}</span>}
            {item.rating && <RatingBadge rating={item.rating} inline />}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-ink-3">
            <span title={places.all} data-testid="wine-places">
              {places.text}
            </span>
            <DrinkLabel drink={item.drink} />
          </p>
        </div>
        <div className="relative z-10 flex shrink-0 flex-col items-end gap-1.5">
          <FavoriteButton
            wineId={item.wineId}
            wine={`${item.producer} ${item.wineName}`}
            favorite={item.favorite}
          />
          <CountBadge count={item.count} />
        </div>
      </article>
    </SwipeFavorite>
  );
}
