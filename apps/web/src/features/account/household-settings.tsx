"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { ERROR_MESSAGES, UpdateHouseholdSchema, type HouseholdSummary } from "@cellr/domain";
import { checkMessage, errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Sheet } from "@/ui/sheet";
import { useToast } from "@/ui/toast";
import { useDeleteHousehold, useUpdateHousehold } from "./hooks";

/** Currencies a household might keep its cellar in. */
const CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "CAD",
  "AUD",
  "NZD",
  "ZAR",
  "JPY",
];

/** What the owner can change about the household: its name and currency, or all of it going away. */
export function HouseholdSettings({ household }: { household: HouseholdSummary }) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const te = useTranslations();
  const toast = useToast();
  const update = useUpdateHousehold();
  const [name, setName] = useState(household.name);
  const [currency, setCurrency] = useState(household.currency);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const changed = name.trim() !== household.name || currency !== household.currency;

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = UpdateHouseholdSchema.safeParse({ name, currency });
    if (!parsed.success) return setError(checkMessage(parsed.error.issues, te));
    try {
      await update.mutateAsync({ id: household.id, patch: parsed.data });
      toast.show(t("householdSaved"));
    } catch (e) {
      setError(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
    }
  }

  return (
    <>
      <form onSubmit={save} noValidate className="flex flex-col gap-5">
        <Field
          label={t("householdNameLabel")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="household-currency" className="text-small font-medium text-ink-2">
            {t("currencyLabel")}
          </label>
          <select
            id="household-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="h-12 w-full rounded-full border border-hairline bg-surface px-5 text-body text-ink focus-visible:border-accent-fg focus-visible:outline-none"
          >
            {[...new Set([household.currency, ...CURRENCIES])].map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <p className="text-caption text-ink-3">{t("currencyHint")}</p>
        </div>
        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
        {changed && (
          <Button type="submit" loading={update.isPending} className="self-start">
            {t("saveHousehold")}
          </Button>
        )}
      </form>
      <Button variant="danger" size="sm" className="mt-3 -ml-3" onClick={() => setDeleting(true)}>
        {t("deleteHousehold")}
      </Button>
      <DeleteSheet
        open={deleting}
        onClose={() => setDeleting(false)}
        household={household}
        closeLabel={tc("close")}
      />
    </>
  );
}

/** Deleting everything is the one thing here that cannot be undone, so it asks for the household's name. */
function DeleteSheet({
  open,
  onClose,
  household,
  closeLabel,
}: {
  open: boolean;
  onClose: () => void;
  household: HouseholdSummary;
  closeLabel: string;
}) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const te = useTranslations();
  const toast = useToast();
  const remove = useDeleteHousehold();
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === household.name;
  // Cancelled means forgotten: opening it again starts empty.
  const close = () => {
    setTyped("");
    onClose();
  };

  async function confirm() {
    try {
      await remove.mutateAsync(household.id);
      // Full reload on purpose: drop every cached page and query that belonged to that household.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    } catch (e) {
      toast.show(
        errorMessage(e, (k) => te(k), ERROR_MESSAGES),
        { tone: "error" },
      );
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t("deleteHouseholdTitle", { household: household.name })}
      closeLabel={closeLabel}
    >
      {open && (
        <div className="flex flex-col gap-5">
          <p className="text-body text-ink-2">
            {t("deleteHouseholdBody", { household: household.name })}
          </p>
          <Field
            label={t("deleteHouseholdConfirmLabel")}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
          <div className="flex flex-col gap-2">
            <Button variant="secondary" size="lg" block onClick={close}>
              {tc("cancel")}
            </Button>
            <Button
              variant="danger"
              size="lg"
              block
              disabled={!matches}
              loading={remove.isPending}
              onClick={confirm}
            >
              {t("deleteHouseholdConfirm")}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
