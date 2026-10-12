"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ERROR_MESSAGES } from "@cellr/domain";
import { errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Sheet } from "@/ui/sheet";
import { useDeleteAccount } from "./hooks";

/** The one thing here that cannot be undone, so it asks for the person's own email address. */
export function DeleteAccountSheet({
  open,
  onClose,
  email,
}: {
  open: boolean;
  onClose: () => void;
  email: string;
}) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const te = useTranslations();
  const remove = useDeleteAccount();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  async function confirm() {
    setError(null);
    try {
      await remove.mutateAsync(typed.trim());
      // Full reload on purpose: no cached page of this account may survive.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/sign-in");
    } catch (e) {
      setError(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("deleteAccountTitle")} closeLabel={tc("close")}>
      {open && (
        <div className="flex flex-col gap-5">
          <p className="text-body text-ink-2">{t("deleteAccountBody")}</p>
          <Field
            label={t("deleteAccountConfirmLabel")}
            type="email"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-small text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button variant="secondary" size="lg" block onClick={onClose}>
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
              {t("deleteAccountConfirm")}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
