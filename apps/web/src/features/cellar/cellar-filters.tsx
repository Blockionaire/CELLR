"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  activeFilterCount,
  facetsOf,
  NO_FILTERS,
  SORTS,
  VINTAGE_BANDS,
  WINE_TYPES,
  type CellarFilters,
  type CellarItem,
  type CellarSort,
  type VintageBand,
  type WineType,
} from "@cellr/domain";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { cn } from "@/ui/cn";
import { CloseIcon, HeartIcon, SlidersIcon } from "@/ui/icons";
import { Sheet } from "@/ui/sheet";
import { countryName } from "./wine-visuals";

/** The Filter button next to the search field: a badge says how many choices are narrowing the list. */
export function FilterButton({
  active,
  onClick,
  className,
}: {
  active: number;
  onClick: () => void;
  className?: string;
}) {
  const t = useTranslations("cellarFilters");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={active > 0 ? t("buttonActive", { count: active }) : t("button")}
      className={cn(
        "relative inline-flex h-12 shrink-0 items-center gap-2 rounded-control border border-hairline bg-surface px-4 text-body font-medium text-ink transition-colors hover:bg-raised active:scale-[0.98]",
        className,
      )}
    >
      <SlidersIcon size={20} />
      <span className="hidden sm:inline">{t("button")}</span>
      {active > 0 && (
        <span
          aria-hidden="true"
          className="grid size-5 place-items-center rounded-full bg-accent text-caption font-medium text-accent-ink tnum"
        >
          {active}
        </span>
      )}
    </button>
  );
}

type Removal = { key: string; name: string; remove: () => void };

/** What is narrowing the list, each with a × to take it off. */
export function ActiveFilters({
  filters,
  onChange,
}: {
  filters: CellarFilters;
  onChange: (next: CellarFilters) => void;
}) {
  const t = useTranslations("cellarFilters");
  const tTypes = useTranslations("wineTypes");
  const locale = useLocale();
  const without =
    <K extends keyof CellarFilters>(key: K, value: string) =>
    () =>
      onChange({ ...filters, [key]: (filters[key] as string[]).filter((v) => v !== value) });
  const chips: Removal[] = [
    ...(filters.favoritesOnly
      ? [
          {
            key: "fav",
            name: t("favorites"),
            remove: () => onChange({ ...filters, favoritesOnly: false }),
          },
        ]
      : []),
    ...filters.types.map((v) => ({ key: `t-${v}`, name: tTypes(v), remove: without("types", v) })),
    ...filters.countries.map((v) => ({
      key: `c-${v}`,
      name: countryName(v, locale) ?? v,
      remove: without("countries", v),
    })),
    ...filters.places.map((v) => ({ key: `p-${v}`, name: v, remove: without("places", v) })),
    ...filters.bands.map((v) => ({
      key: `b-${v}`,
      name: t(`bands.${v}`),
      remove: without("bands", v),
    })),
  ];
  if (chips.length === 0) return null;
  return (
    <ul className="-mt-3 mb-5 flex flex-wrap gap-2" aria-label={t("activeLabel")}>
      {chips.map((c) => (
        <li key={c.key}>
          <button
            type="button"
            onClick={c.remove}
            aria-label={t("remove", { name: c.name })}
            className="inline-flex h-9 items-center gap-1.5 rounded-control bg-accent pl-3.5 pr-2.5 text-small text-accent-ink transition-transform active:scale-[0.97]"
          >
            {c.name}
            <CloseIcon size={16} />
          </button>
        </li>
      ))}
    </ul>
  );
}

interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  /** Every card in the cellar: the choices on offer come from what is actually there. */
  items: readonly CellarItem[];
  filters: CellarFilters;
  onFilters: (next: CellarFilters) => void;
  sort: CellarSort;
  onSort: (next: CellarSort) => void;
  /** How many cards the current choices would show. */
  matches: number;
}

const toggle = <T extends string>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

export function FilterSheet({
  open,
  onClose,
  items,
  filters,
  onFilters,
  sort,
  onSort,
  matches,
}: FilterSheetProps) {
  const t = useTranslations("cellarFilters");
  const tTypes = useTranslations("wineTypes");
  const locale = useLocale();
  const facets = facetsOf(items);
  const active = activeFilterCount(filters);

  return (
    <Sheet open={open} onClose={onClose} title={t("title")}>
      <div className="flex flex-col gap-7">
        <Group title={t("sortBy")}>
          {SORTS.map((s) => (
            <Chip key={s} selected={sort === s} onClick={() => onSort(s)}>
              {t(`sort.${s}`)}
            </Chip>
          ))}
        </Group>

        <button
          type="button"
          aria-pressed={filters.favoritesOnly}
          onClick={() => onFilters({ ...filters, favoritesOnly: !filters.favoritesOnly })}
          className={cn(
            "flex min-h-12 items-center gap-3 rounded-control border px-4 text-left text-body transition-colors active:scale-[0.99]",
            filters.favoritesOnly
              ? "border-transparent bg-accent text-accent-ink"
              : "border-hairline bg-surface text-ink",
          )}
        >
          <HeartIcon size={20} filled={filters.favoritesOnly} />
          {t("favorites")}
        </button>

        {facets.types.length > 1 && (
          <Group title={t("type")}>
            {WINE_TYPES.filter((v) => facets.types.some((f) => f.value === v)).map((v) => (
              <Chip
                key={v}
                selected={filters.types.includes(v)}
                onClick={() => onFilters({ ...filters, types: toggle<WineType>(filters.types, v) })}
              >
                {tTypes(v)} <Count n={facets.types.find((f) => f.value === v)?.count ?? 0} />
              </Chip>
            ))}
          </Group>
        )}

        {facets.countries.length > 1 && (
          <Group title={t("country")}>
            {facets.countries.map((f) => (
              <Chip
                key={f.value}
                selected={filters.countries.includes(f.value)}
                onClick={() =>
                  onFilters({ ...filters, countries: toggle(filters.countries, f.value) })
                }
              >
                {countryName(f.value, locale) ?? f.value} <Count n={f.count} />
              </Chip>
            ))}
          </Group>
        )}

        {facets.bands.length > 1 && (
          <Group title={t("vintage")}>
            {VINTAGE_BANDS.filter((v) => facets.bands.some((f) => f.value === v)).map((v) => (
              <Chip
                key={v}
                selected={filters.bands.includes(v)}
                onClick={() =>
                  onFilters({ ...filters, bands: toggle<VintageBand>(filters.bands, v) })
                }
              >
                {t(`bands.${v}`)} <Count n={facets.bands.find((f) => f.value === v)?.count ?? 0} />
              </Chip>
            ))}
          </Group>
        )}

        {facets.places.length > 1 && (
          <Group title={t("place")}>
            {facets.places.map((f) => (
              <Chip
                key={f.value}
                selected={filters.places.includes(f.value)}
                onClick={() => onFilters({ ...filters, places: toggle(filters.places, f.value) })}
              >
                {f.value} <Count n={f.count} />
              </Chip>
            ))}
          </Group>
        )}

        <div className="sticky bottom-0 -mx-5 flex gap-3 border-t border-hairline bg-surface px-5 pb-1 pt-4">
          <Button
            variant="secondary"
            size="lg"
            disabled={active === 0}
            onClick={() => onFilters(NO_FILTERS)}
          >
            {t("reset")}
          </Button>
          <Button size="lg" className="flex-1" onClick={onClose}>
            {t("show", { count: matches })}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 text-small font-medium text-ink-2">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function Count({ n }: { n: number }) {
  return <span className="ml-1 opacity-70 tnum">{n}</span>;
}
