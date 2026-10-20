"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  AddBottlesSchema,
  BottleExtrasSchema,
  ERROR_MESSAGES,
  formatVintage,
  MAX_BOTTLES_PER_ADD,
  parseMoneyToCents,
  type AddBottlesResult,
  type StorageUnitView,
  type WineSummary,
} from "@cellr/domain";
import { checkMessage, errorMessage } from "@/lib/api";
import { todayLocal } from "@/lib/local-date";
import { Skeleton } from "@/ui/skeleton";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { Field } from "@/ui/field";
import {
  draftToInput,
  EMPTY_DRAFT,
  ExtrasFields,
  hasDraft,
  type ExtrasDraft,
} from "@/features/insights/extras-fields";
import { api } from "@/lib/api";
import { CheckIcon, PlusIcon } from "@/ui/icons";
import { Stepper } from "@/ui/stepper";
import { cn } from "@/ui/cn";
import { useAddBottles, useStorage } from "./hooks";
import { NewPlaceSheet } from "./new-place-sheet";
import { WineStage } from "./wine-stage";
import { placeLine } from "./wine-visuals";

interface BottleDetailsProps {
  wine: WineSummary;
  currency: string;
  /** Last place used, so adding a second bottle is two taps shorter. */
  preferredPlaceId: string | null | undefined;
  /** Pre-filled vintage (e.g. "Add more" from the detail screen): a year, null for NV, undefined for none. */
  initialYear?: number | null | undefined;
  /** A label photo already kept (from a scan): the new bottles are given it. */
  imageId?: string | undefined;
  /** Something to offer under the "Add" button (a scan offers "save to wishlist instead"). */
  footer?: ReactNode;
  onChangeWine: () => void;
  onDone: (result: AddBottlesResult, placeId: string | null) => void;
}

/** A clean section of the form: one thing to answer, on its own card. */
const SECTION = "rounded-card bg-surface p-4 shadow-raised ring-1 ring-hairline";

const currencySymbol = (currency: string, locale: string) => {
  try {
    return (
      new Intl.NumberFormat(locale, { style: "currency", currency })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? currency
    );
  } catch {
    return currency;
  }
};

/** Step 2: everything about THESE bottles on one screen — vintage, how many, where, what they cost. */
export function BottleDetails({
  wine,
  currency,
  preferredPlaceId,
  initialYear,
  imageId,
  footer,
  onChangeWine,
  onDone,
}: BottleDetailsProps) {
  const t = useTranslations("addBottle");
  const tKinds = useTranslations("storageKinds");
  const te = useTranslations();
  const locale = useLocale();
  const storage = useStorage();
  const add = useAddBottles();

  const [yearText, setYearText] = useState(
    typeof initialYear === "number" ? String(initialYear) : "",
  );
  const [nv, setNv] = useState(initialYear === null);
  const [quantity, setQuantity] = useState(1);
  /** undefined = "not chosen yet": the first place with room is preselected. */
  const [chosenPlace, setChosenPlace] = useState<string | null | undefined>(preferredPlaceId);
  const [priceText, setPriceText] = useState("");
  const [date, setDate] = useState("");
  const [shop, setShop] = useState("");
  const [extras, setExtras] = useState<ExtrasDraft>(EMPTY_DRAFT);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const units: StorageUnitView[] = storage.data ?? [];
  /** The place bottles go: the one chosen, else the first with room for all of them, else any with room. */
  const placeIn = (list: StorageUnitView[]): string | null =>
    chosenPlace !== undefined && (chosenPlace === null || list.some((u) => u.id === chosenPlace))
      ? chosenPlace
      : (list.find((u) => u.free >= quantity)?.id ?? list.find((u) => u.free > 0)?.id ?? null);
  const placeId = placeIn(units);
  const unit = units.find((u) => u.id === placeId) ?? null;

  const thisYear = new Date().getFullYear();
  const recentYears = Array.from({ length: 6 }, (_, i) => thisYear - 1 - i);
  const year: number | null | undefined = nv
    ? null
    : /^\d{4}$/.test(yearText) && Number(yearText) >= 1800 && Number(yearText) <= 2100
      ? Number(yearText)
      : undefined;
  const priceCents = parseMoneyToCents(priceText);
  const symbol = currencySymbol(currency, locale);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    if (year === undefined || priceCents === undefined) return;
    // Saved before the places had loaded? Wait for them, so the bottles go where the form would have offered.
    const target = storage.isPending ? placeIn((await storage.refetch()).data ?? []) : placeId;
    const parsed = AddBottlesSchema.safeParse({
      wineId: wine.id,
      year,
      quantity,
      locationId: target,
      priceCents,
      purchasedAt: date || null,
      purchasedFrom: extras.acquiredHow === "gift" ? null : shop,
      ...(imageId ? { imageId } : {}),
    });
    if (!parsed.success) return setError(checkMessage(parsed.error.issues, te));
    const extrasParsed = BottleExtrasSchema.safeParse(draftToInput(extras));
    if (!extrasParsed.success) return setError(checkMessage(extrasParsed.error.issues, te));
    try {
      const result = await add.mutateAsync(parsed.data);
      // What you know about these bottles (a gift? kept for a day?) is saved right after; the bottles are
      // already in the cellar, so a failure here can't undo them: it can be set again from the wine's page.
      if (hasDraft(extras))
        await Promise.allSettled(
          result.bottleIds.map((id) => api.put(`/bottles/${id}/extras`, extrasParsed.data)),
        );
      onDone(result, target);
    } catch (e) {
      setError(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
    }
  }

  const where = placeLine(wine.region, wine.countryCode, locale);
  return (
    <>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <div className="flex items-center gap-4 rounded-card bg-surface p-3 shadow-raised ring-1 ring-hairline">
          <WineStage
            type={wine.type}
            producer={wine.producer}
            name={wine.name}
            year={year === undefined ? undefined : formatVintage(year)}
            size="card"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-caption font-medium uppercase tracking-[0.14em] text-bronze">
              {wine.producer}
            </p>
            <p className="mt-0.5 line-clamp-2 font-display text-title text-ink">{wine.name}</p>
            <p className="mt-1 text-small text-ink-2 tnum">
              {[year === undefined ? null : formatVintage(year), where]
                .filter(Boolean)
                .join(" · ") || " "}
            </p>
          </div>
          <button
            type="button"
            onClick={onChangeWine}
            className="shrink-0 self-start rounded-full px-3.5 py-2 text-small font-medium text-accent-fg ring-1 ring-hairline transition-colors duration-150 ease-cellr hover:bg-raised"
          >
            {t("change")}
          </button>
        </div>

        <section className={cn(SECTION, "flex flex-col gap-3")}>
          <Field
            label={t("yearLabel")}
            inputMode="numeric"
            maxLength={4}
            autoFocus
            autoComplete="off"
            placeholder={t("yearPlaceholder")}
            disabled={nv}
            value={nv ? "" : yearText}
            error={submitted && year === undefined ? t("yearError") : null}
            onChange={(e) => setYearText(e.target.value.replace(/\D/g, ""))}
          />
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
            <Chip selected={nv} onClick={() => setNv(!nv)}>
              {t("nv")}
            </Chip>
            {recentYears.map((y) => (
              <Chip
                key={y}
                selected={!nv && yearText === String(y)}
                onClick={() => {
                  setNv(false);
                  setYearText(String(y));
                }}
                className="tnum"
              >
                {y}
              </Chip>
            ))}
          </div>
        </section>

        <section
          className={cn(
            SECTION,
            "flex flex-col items-center gap-3 sm:flex-row sm:justify-between sm:gap-4",
          )}
        >
          <p className="text-body text-ink">{t("quantityLabel")}</p>
          <Stepper
            label={t("quantityLabel")}
            value={quantity}
            onChange={setQuantity}
            min={1}
            max={MAX_BOTTLES_PER_ADD}
            className="gap-3"
          />
        </section>

        <section className={SECTION}>
          <h2 className="mb-3 text-small font-medium text-ink-2" id="where-label">
            {t("whereLabel")}
          </h2>
          <div
            role="radiogroup"
            aria-labelledby="where-label"
            className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
          >
            {storage.isPending
              ? // Until the places are known, nothing looks chosen: saving now waits for them (see submit).
                [0, 1].map((i) => <Skeleton key={i} className="min-h-[4.5rem] rounded-[16px]" />)
              : units.map((u) => {
                  const selected = u.id === placeId;
                  return (
                    <PlaceOption
                      key={u.id}
                      selected={selected}
                      title={u.label}
                      detail={[
                        // "Wine fridge" is both the default name and the kind: say it once.
                        u.label === tKinds(u.kind) ? null : tKinds(u.kind),
                        u.free > 0
                          ? t("freeOf", { free: u.free, capacity: u.capacity })
                          : t("full"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      fill={u.capacity > 0 ? Math.min(1, u.used / u.capacity) : undefined}
                      onSelect={() => setChosenPlace(u.id)}
                    />
                  );
                })}
            <PlaceOption
              selected={storage.isPending ? chosenPlace === null : placeId === null}
              title={t("notPlaced")}
              detail={t("notPlacedHint")}
              onSelect={() => setChosenPlace(null)}
            />
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="flex min-h-[4.5rem] flex-col items-start justify-center gap-0.5 rounded-[16px] border border-dashed border-accent-fg/50 p-3 text-left transition-transform duration-150 ease-cellr active:scale-[0.98]"
            >
              <span className="flex items-center gap-2 text-body font-medium text-ink">
                <PlusIcon size={18} className="text-accent-fg" />
                {t("newPlace")}
              </span>
              <span className="text-small text-ink-2">{t("newPlaceHint")}</span>
            </button>
          </div>
          {unit && unit.free < quantity && (
            <p role="status" className="mt-3 text-small text-ink-2">
              {t("notEnough", { free: unit.free, rest: quantity - unit.free })}
            </p>
          )}
        </section>

        <section className={cn(SECTION, "flex flex-col gap-4")}>
          <Field
            label={t("priceLabel", { symbol })}
            hint={t("priceHint")}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            value={priceText}
            error={submitted && priceCents === undefined ? t("priceError") : null}
            onChange={(e) => setPriceText(e.target.value)}
          />
          <details className="group">
            <summary className="cursor-pointer select-none py-2 text-small font-medium text-ink-2">
              {t("moreDetails")}
            </summary>
            <div className="flex flex-col gap-5 pt-3">
              <ExtrasFields value={extras} onChange={setExtras} />
              {extras.acquiredHow !== "gift" && (
                <Field
                  label={t("shopLabel")}
                  placeholder={t("shopPlaceholder")}
                  maxLength={120}
                  value={shop}
                  onChange={(e) => setShop(e.target.value)}
                />
              )}
              <Field
                label={t("dateLabel")}
                type="date"
                max={todayLocal()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </details>
        </section>

        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" block loading={add.isPending}>
          {t("submit", { count: quantity })}
        </Button>
        {footer}
      </form>

      {/* Outside the <form>: forms cannot be nested, and the sheet has its own. */}
      <NewPlaceSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onCreated={(created) => setChosenPlace(created.id)}
      />
    </>
  );
}

/** A place as a tile: its name, how much room is left, and a thin meter of how full it is. */
function PlaceOption({
  selected,
  title,
  detail,
  fill,
  onSelect,
}: {
  selected: boolean;
  title: string;
  detail: string;
  /** 0 to 1: how much of the place is taken. Left out for "not placed yet". */
  fill?: number | undefined;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-[4.5rem] flex-col items-start justify-between gap-2 rounded-[16px] p-3 text-left transition-transform duration-150 ease-cellr active:scale-[0.98]",
        selected ? "bg-surface ring-2 ring-accent-fg" : "bg-canvas ring-1 ring-hairline",
      )}
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="text-body font-medium text-ink">{title}</span>
        {selected && (
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
            <CheckIcon size={12} />
          </span>
        )}
      </span>
      <span className="text-small text-ink-2">{detail}</span>
      {fill !== undefined && (
        <span aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
          <span
            className="block h-full rounded-full bg-accent"
            style={{ width: `${Math.round(fill * 100)}%` }}
          />
        </span>
      )}
    </button>
  );
}
