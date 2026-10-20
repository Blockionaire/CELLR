"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";
import {
  ERROR_MESSAGES,
  parseMoneyToCents,
  UpdatePurchaseSchema,
  UpdateWineSchema,
  WINE_COUNTRIES,
  type UpdatePurchase,
  type UpdateWine,
  type VintageDetail,
} from "@cellr/domain";
import { checkMessage, errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Sheet } from "@/ui/sheet";
import { useToast } from "@/ui/toast";
import { useUpdatePurchase, useUpdateWine } from "./hooks";
import { countryName } from "./wine-visuals";

interface EditSheetProps {
  open: boolean;
  onClose: () => void;
  detail: VintageDetail;
}

export function EditSheet({ open, onClose, detail }: EditSheetProps) {
  const t = useTranslations("editWine");
  return (
    <Sheet open={open} onClose={onClose} title={t("title")} description={detail.wine.name}>
      {/* Remounted on every open, so the fields always start from what is saved. */}
      {open && <EditForm detail={detail} onClose={onClose} />}
    </Sheet>
  );
}

const sameValue = <T,>(list: readonly T[]): T | null =>
  list.length > 0 && list.every((v) => v === list[0]) ? (list[0] ?? null) : null;

function EditForm({ detail, onClose }: { detail: VintageDetail; onClose: () => void }) {
  const t = useTranslations("editWine");
  const te = useTranslations();
  const locale = useLocale();
  const toast = useToast();
  const updateWine = useUpdateWine();
  const updatePurchase = useUpdatePurchase();
  const countryId = useId();

  const { wine, bottles } = detail;
  const sharedPrice = sameValue(bottles.map((b) => b.priceCents));
  const sharedDate = sameValue(bottles.map((b) => b.purchasedAt));
  const pricesDiffer = new Set(bottles.map((b) => b.priceCents)).size > 1;
  const symbol = (() => {
    try {
      return (
        new Intl.NumberFormat(locale, { style: "currency", currency: detail.currency ?? "EUR" })
          .formatToParts(0)
          .find((p) => p.type === "currency")?.value ?? "€"
      );
    } catch {
      return "€";
    }
  })();

  const [name, setName] = useState(wine.name);
  const [region, setRegion] = useState(wine.region ?? "");
  const [country, setCountry] = useState(wine.countryCode ?? "");
  const [appellation, setAppellation] = useState(wine.appellation ?? "");
  const [price, setPrice] = useState(sharedPrice === null ? "" : (sharedPrice / 100).toFixed(2));
  const [date, setDate] = useState(sharedDate ?? "");
  const [shop, setShop] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = updateWine.isPending || updatePurchase.isPending;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const winePatch: UpdateWine = {};
    if (name.trim() !== wine.name) winePatch.name = name;
    if (region.trim() !== (wine.region ?? "")) winePatch.region = region;
    if (country !== (wine.countryCode ?? ""))
      winePatch.countryCode = country === "" ? null : country;
    if (appellation.trim() !== (wine.appellation ?? "")) winePatch.appellation = appellation;

    const purchasePatch: UpdatePurchase = {};
    const cents = parseMoneyToCents(price);
    if (cents === undefined) return setError(te("addBottle.priceError"));
    if (cents !== sharedPrice && !(pricesDiffer && price.trim() === ""))
      purchasePatch.priceCents = cents;
    if (date !== (sharedDate ?? "")) purchasePatch.purchasedAt = date === "" ? null : date;
    if (shop.trim() !== "") purchasePatch.purchasedFrom = shop;

    const wineParsed =
      Object.keys(winePatch).length > 0 ? UpdateWineSchema.safeParse(winePatch) : null;
    if (wineParsed && !wineParsed.success)
      return setError(checkMessage(wineParsed.error.issues, te));
    const purchaseParsed =
      Object.keys(purchasePatch).length > 0 ? UpdatePurchaseSchema.safeParse(purchasePatch) : null;
    if (purchaseParsed && !purchaseParsed.success)
      return setError(checkMessage(purchaseParsed.error.issues, te));

    try {
      if (wineParsed?.success)
        await updateWine.mutateAsync({ wineId: wine.id, patch: wineParsed.data });
      if (purchaseParsed?.success)
        await updatePurchase.mutateAsync({
          vintageId: detail.vintageId,
          patch: purchaseParsed.data,
        });
      onClose();
      toast.show(t("saved"));
    } catch (e) {
      setError(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-8">
      <section className="flex flex-col gap-5">
        <h3 className="text-small font-medium uppercase tracking-[0.14em] text-ink-2">
          {t("wineSection")}
        </h3>
        <Field
          label={te("addBottle.nameLabel")}
          autoComplete="off"
          autoCapitalize="words"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label={te("addBottle.regionLabel")}
          autoComplete="off"
          autoCapitalize="words"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={countryId} className="text-small font-medium text-ink-2">
            {te("addBottle.countryLabel")}
          </label>
          <select
            id={countryId}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="h-12 w-full rounded-control border border-hairline bg-surface px-3 text-body text-ink focus-visible:border-accent-fg focus-visible:outline-none"
          >
            <option value="">{te("addBottle.countryNone")}</option>
            {[...new Set([...(wine.countryCode ? [wine.countryCode] : []), ...WINE_COUNTRIES])].map(
              (code) => (
                <option key={code} value={code}>
                  {countryName(code, locale)}
                </option>
              ),
            )}
          </select>
        </div>
        <Field
          label={te("vintage.appellation")}
          autoComplete="off"
          value={appellation}
          onChange={(e) => setAppellation(e.target.value)}
        />
      </section>

      {bottles.length > 0 && (
        <section className="flex flex-col gap-5">
          <div>
            <h3 className="text-small font-medium uppercase tracking-[0.14em] text-ink-2">
              {t("purchaseSection")}
            </h3>
            <p className="mt-1 text-small text-ink-2">{t("applyAll", { count: bottles.length })}</p>
          </div>
          <Field
            label={t("priceLabel", { symbol })}
            inputMode="decimal"
            autoComplete="off"
            hint={pricesDiffer ? t("pricesDiffer") : undefined}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          <Field
            label={t("dateLabel")}
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Field
            label={t("shopLabel")}
            placeholder={t("shopPlaceholder")}
            autoComplete="off"
            value={shop}
            onChange={(e) => setShop(e.target.value)}
          />
        </section>
      )}

      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" block loading={busy}>
        {t("save")}
      </Button>
    </form>
  );
}
