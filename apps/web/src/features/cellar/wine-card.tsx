import { useTranslations } from "next-intl";
import { formatVintage, type CellarItem } from "@cellr/domain";
import { BottleGlyph } from "@/ui/bottle-glyph";
import { placeLine, shapeFor } from "./wine-visuals";

interface ItemProps {
  item: CellarItem;
  locale: string;
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
    <span className="rounded-full bg-accent px-2.5 py-1 text-caption font-medium text-accent-ink tnum">
      <span aria-hidden="true">×{count}</span>
      <span className="sr-only">{t("bottlesLabel", { count })}</span>
    </span>
  );
}

/** Grid card: the bottle is the hero, text stays small and calm. */
export function WineCard({ item, locale }: ItemProps) {
  const places = usePlaces(item);
  const where = placeLine(item.region, item.countryCode, locale);
  return (
    <article className="flex h-full flex-col rounded-card border border-hairline bg-surface p-3 shadow-raised">
      <div className="relative grid h-36 place-items-center rounded-control bg-raised">
        <BottleGlyph shape={shapeFor(item.type)} tint={item.type} className="w-9" />
        <span className="absolute right-2 top-2">
          <CountBadge count={item.count} />
        </span>
      </div>
      <div className="mt-3 flex-1">
        <p className="truncate text-caption font-medium uppercase tracking-[0.12em] text-ink-3">
          {item.producer}
        </p>
        <h3 className="mt-0.5 line-clamp-2 font-display text-title text-ink">{item.wineName}</h3>
        <p className="mt-1 text-small text-ink-2">
          <span className="tnum">{formatVintage(item.year)}</span>
          {where && <span> · {where}</span>}
        </p>
      </div>
      <p className="mt-3 truncate text-caption text-ink-3">{places}</p>
    </article>
  );
}

/** Compact row for people who like to see more at once. */
export function WineRow({ item, locale }: ItemProps) {
  const places = usePlaces(item);
  const where = placeLine(item.region, item.countryCode, locale);
  return (
    <article className="flex min-h-[4.5rem] items-center gap-4 px-1 py-3">
      <BottleGlyph shape={shapeFor(item.type)} tint={item.type} className="w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-caption font-medium uppercase tracking-[0.12em] text-ink-3">
          {item.producer}
        </p>
        <h3 className="truncate font-display text-title text-ink">{item.wineName}</h3>
        <p className="truncate text-small text-ink-2">
          <span className="tnum">{formatVintage(item.year)}</span>
          {where && <span> · {where}</span>}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <CountBadge count={item.count} />
        <p className="max-w-[9rem] truncate text-caption text-ink-3">{places}</p>
      </div>
    </article>
  );
}
