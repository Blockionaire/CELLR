"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ERROR_MESSAGES, isGuessablePin, type PinStatus } from "@cellr/domain";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { rememberPin } from "./device-memory";
import { PinPad } from "./pin-pad";

/** Choose a PIN, then type it again. Saves it and remembers on this phone that the account has one. */
export function PinSetup({
  email,
  onDone,
  onCancel,
  cancelLabel,
}: {
  /** The account's email, so this phone can open the PIN screen next time. */
  email: string | null;
  onDone: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const t = useTranslations("pin");
  const te = useTranslations();
  const [first, setFirst] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const save = useMutation({
    mutationFn: (pin: string) => api.put<PinStatus>("/me/pin", { pin }),
    meta: { refresh: false }, // during sign-in a refresh would leave the sign-in page too early
  });

  const fail = (message: string) => {
    setError(message);
    setAttempt((a) => a + 1);
    setValue("");
  };

  const complete = (pin: string) => {
    if (first === null) {
      if (isGuessablePin(pin)) return fail(t("tooEasy"));
      setError(null);
      setFirst(pin);
      setValue("");
      return;
    }
    if (pin !== first) {
      setFirst(null);
      return fail(t("noMatch"));
    }
    save.mutate(pin, {
      onSuccess: () => {
        rememberPin(true, email);
        onDone();
      },
      onError: (e) => {
        setFirst(null);
        fail(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
      },
    });
  };

  return (
    <div className="flex flex-col items-center gap-6" data-testid="pin-setup">
      <p className="text-center text-body text-ink-2">
        {first === null ? t("chooseHint") : t("confirmHint")}
      </p>
      <PinPad
        label={first === null ? t("choose") : t("confirm")}
        value={value}
        onChange={(v) => {
          setValue(v);
          if (v.length > 0) setError(null);
        }}
        onComplete={complete}
        error={error}
        attempt={attempt}
        disabled={save.isPending}
      />
      {onCancel && (
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {cancelLabel ?? t("notNow")}
        </Button>
      )}
    </div>
  );
}
