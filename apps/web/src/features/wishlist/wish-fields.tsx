"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { parseMoneyToCents } from "@cellr/domain";
import { Field } from "@/ui/field";
import { Textarea } from "@/ui/textarea";

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

export interface WishValues {
  /** null = any vintage; undefined = what was typed is not a year. */
  year: number | null | undefined;
  note: string | null;
  /** undefined = what was typed is not a price. */
  maxPriceCents: number | null | undefined;
}

/**
 * The three things a wish can say besides the wine: which vintage (or any), a note, and the most it should
 * cost. Used both when adding one and when editing it, so the two always look and behave the same.
 */
export function useWishFields(
  currency: string,
  initial: { year: number | null; note: string | null; maxPriceCents: number | null },
) {
  const t = useTranslations("wishlist");
  const locale = useLocale();
  const [yearText, setYearText] = useState(initial.year === null ? "" : String(initial.year));
  const [note, setNote] = useState(initial.note ?? "");
  const [price, setPrice] = useState(
    initial.maxPriceCents === null ? "" : (initial.maxPriceCents / 100).toFixed(2),
  );
  const [submitted, setSubmitted] = useState(false);

  const year: number | null | undefined =
    yearText === ""
      ? null
      : /^\d{4}$/.test(yearText) && Number(yearText) >= 1800 && Number(yearText) <= 2100
        ? Number(yearText)
        : undefined;
  const maxPriceCents = price.trim() === "" ? null : parseMoneyToCents(price);
  const values: WishValues = { year, note: note.trim() === "" ? null : note.trim(), maxPriceCents };
  const valid = year !== undefined && maxPriceCents !== undefined;

  const fields = (
    <div className="flex flex-col gap-6">
      <Field
        label={t("yearLabel")}
        hint={t("yearHint")}
        inputMode="numeric"
        maxLength={4}
        autoComplete="off"
        value={yearText}
        error={submitted && year === undefined ? t("yearError") : null}
        onChange={(e) => setYearText(e.target.value.replace(/\D/g, ""))}
      />
      <Field
        label={t("priceLabel", { symbol: currencySymbol(currency, locale) })}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        value={price}
        error={submitted && maxPriceCents === undefined ? t("priceError") : null}
        onChange={(e) => setPrice(e.target.value)}
      />
      <Textarea
        label={t("noteLabel")}
        placeholder={t("notePlaceholder")}
        rows={3}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </div>
  );
  return { fields, values, valid, markSubmitted: () => setSubmitted(true) };
}
