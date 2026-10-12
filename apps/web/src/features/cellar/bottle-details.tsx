"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  AddBottlesSchema,
  ERROR_MESSAGES,
  MAX_BOTTLES_PER_ADD,
  parseMoneyToCents,
  type AddBottlesResult,
  type StorageUnitView,
  type WineSummary,
} from "@cellr/domain";
import { errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Chip } from "@/ui/chip";
import { Field } from "@/ui/field";
import { PlusIcon } from "@/ui/icons";
import { Stepper } from "@/ui/stepper";
import { cn } from "@/ui/cn";
import { useAddBottles, useStorage } from "./hooks";
import { NewPlaceSheet } from "./new-place-sheet";
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
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const units: StorageUnitView[] = storage.data ?? [];
  const placeId =
    chosenPlace !== undefined && (chosenPlace === null || units.some((u) => u.id === chosenPlace))
      ? chosenPlace
      : (units.find((u) => u.free >= quantity)?.id ?? units.find((u) => u.free > 0)?.id ?? null);
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
    const parsed = AddBottlesSchema.safeParse({
      wineId: wine.id,
      year,
      quantity,
      locationId: placeId,
      priceCents,
      purchasedAt: date || null,
      ...(imageId ? { imageId } : {}),
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? null);
    try {
      onDone(await add.mutateAsync(parsed.data), placeId);
    } catch (e) {
      setError(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
    }
  }

  return (
    <>
      <form onSubmit={submit} noValidate className="flex flex-col gap-8">
        <div className="flex items-start justify-between gap-4 rounded-card border border-hairline bg-surface p-4">
          <div className="min-w-0">
            <p className="truncate text-caption font-medium uppercase tracking-[0.12em] text-ink-3">
              {wine.producer}
            </p>
            <p className="font-display text-title text-ink">{wine.name}</p>
            <p className="text-small text-ink-2">
              {placeLine(wine.region, wine.countryCode, locale) || " "}
            </p>
          </div>
          <button
            type="button"
            onClick={onChangeWine}
            className="shrink-0 py-1 text-small font-medium text-accent-fg"
          >
            {t("change")}
          </button>
        </div>

        <section className="flex flex-col gap-3">
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
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:flex-wrap md:px-0">
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

        <section className="flex items-center justify-between gap-4">
          <p className="text-body text-ink">{t("quantityLabel")}</p>
          <Stepper
            label={t("quantityLabel")}
            value={quantity}
            onChange={setQuantity}
            min={1}
            max={MAX_BOTTLES_PER_ADD}
          />
        </section>

        <section>
          <h2 className="mb-3 text-small font-medium text-ink-2" id="where-label">
            {t("whereLabel")}
          </h2>
          <div role="radiogroup" aria-labelledby="where-label" className="flex flex-col gap-2">
            {storage.isPending
              ? null
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
                      onSelect={() => setChosenPlace(u.id)}
                    />
                  );
                })}
            <PlaceOption
              selected={placeId === null}
              title={t("notPlaced")}
              detail={t("notPlacedHint")}
              onSelect={() => setChosenPlace(null)}
            />
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="flex min-h-14 items-center gap-3 rounded-card border border-dashed border-hairline px-4 text-left text-body text-ink transition-colors hover:bg-raised active:bg-raised"
            >
              <span className="grid size-8 place-items-center rounded-full bg-raised text-ink">
                <PlusIcon size={18} />
              </span>
              <span>
                {t("newPlace")}
                <span className="block text-small text-ink-3">{t("newPlaceHint")}</span>
              </span>
            </button>
          </div>
          {unit && unit.free < quantity && (
            <p role="status" className="mt-3 text-small text-ink-2">
              {t("notEnough", { free: unit.free, rest: quantity - unit.free })}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-4">
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
            <div className="pt-3">
              <Field
                label={t("dateLabel")}
                type="date"
                max={new Date().toISOString().slice(0, 10)}
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

function PlaceOption({
  selected,
  title,
  detail,
  onSelect,
}: {
  selected: boolean;
  title: string;
  detail: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-14 flex-col items-start justify-center rounded-card border px-4 py-2 text-left transition-colors active:scale-[0.99]",
        selected ? "border-accent-fg bg-raised" : "border-hairline bg-surface hover:bg-raised",
      )}
    >
      <span className="text-body text-ink">{title}</span>
      <span className="text-small text-ink-3">{detail}</span>
    </button>
  );
}
