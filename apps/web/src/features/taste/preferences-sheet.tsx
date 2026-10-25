"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  ERROR_MESSAGES,
  scalesFor,
  type TastePreferences,
  type TasteScale,
  type WineFocus,
} from "@cellr/domain";
import { errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Segmented } from "@/ui/segmented";
import { Sheet } from "@/ui/sheet";
import { useSaveTaste } from "./hooks";

type Answers = Omit<TastePreferences, "onboarded">;

/**
 * My own taste, said in a few taps: which wines I mostly drink, then (optionally) where I like body, tannin,
 * sweetness and acidity. Every answer can be left unset; "Skip" saves nothing but stops the offer.
 */
export function PreferencesSheet({
  open,
  onClose,
  current,
  onboarding,
}: {
  open: boolean;
  onClose: () => void;
  current: TastePreferences;
  /** First time: one question at a time, with Skip. Otherwise: everything on one page to edit. */
  onboarding: boolean;
}) {
  const t = useTranslations("taste");
  const te = useTranslations();
  const save = useSaveTaste();
  const [step, setStep] = useState<"focus" | "scales">(onboarding ? "focus" : "scales");
  const [a, setA] = useState<Answers>({
    wineFocus: current.wineFocus,
    body: current.body,
    tannin: current.tannin,
    sweetness: current.sweetness,
    acidity: current.acidity,
  });
  const [error, setError] = useState<string | null>(null);

  async function submit(answers: Answers) {
    setError(null);
    try {
      // Tannin is not asked of someone who mostly drinks white or rosé: what is not asked is not kept.
      const asked = new Set(scalesFor(answers.wineFocus));
      await save.mutateAsync({
        ...answers,
        tannin: asked.has("tannin") ? answers.tannin : null,
        onboarded: true,
      });
      onClose();
    } catch (e) {
      setError(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
    }
  }

  const focusOptions: Array<{ value: WineFocus; label: string }> = [
    { value: "red", label: t("focus.red") },
    { value: "white_rose", label: t("focus.white_rose") },
    { value: "both", label: t("focus.both") },
  ];
  const scale = (s: TasteScale) => (
    <fieldset key={s} className="flex flex-col gap-2">
      <legend className="text-small font-medium text-ink">{t(`scales.${s}.question`)}</legend>
      <Segmented
        label={t(`scales.${s}.name`)}
        value={a[s] === null ? "unset" : String(a[s])}
        onChange={(v) => setA((x) => ({ ...x, [s]: v === "unset" ? null : Number(v) }))}
        options={[
          { value: "unset", label: t("unset") },
          ...[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) })),
        ]}
        className="w-full justify-between"
      />
      <p className="flex justify-between text-caption text-ink-3">
        <span>{t(`scales.${s}.low`)}</span>
        <span>{t(`scales.${s}.high`)}</span>
      </p>
    </fieldset>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={onboarding ? t("onboarding.title") : t("edit.title")}
    >
      {step === "focus" ? (
        <div className="flex flex-col gap-4">
          <p className="text-body text-ink-2">{t("onboarding.focusQuestion")}</p>
          <div
            role="radiogroup"
            aria-label={t("onboarding.focusQuestion")}
            className="flex flex-col gap-2"
          >
            {focusOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={a.wineFocus === o.value}
                onClick={() => {
                  setA((x) => ({ ...x, wineFocus: o.value }));
                  setStep("scales");
                }}
                className="min-h-14 rounded-[16px] border border-hairline bg-surface px-4 text-left text-body font-medium text-ink transition-colors duration-150 hover:bg-raised aria-checked:border-accent motion-reduce:transition-none"
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep("scales")}>
              {t("onboarding.skipQuestion")}
            </Button>
            <Button
              variant="ghost"
              loading={save.isPending}
              onClick={() =>
                submit({
                  wineFocus: null,
                  body: null,
                  tannin: null,
                  sweetness: null,
                  acidity: null,
                })
              }
            >
              {t("onboarding.skipAll")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {!onboarding && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-small font-medium text-ink">
                {t("onboarding.focusQuestion")}
              </legend>
              <Segmented
                label={t("onboarding.focusQuestion")}
                value={a.wineFocus ?? "unset"}
                onChange={(v) =>
                  setA((x) => ({ ...x, wineFocus: v === "unset" ? null : (v as WineFocus) }))
                }
                options={[{ value: "unset", label: t("unset") }, ...focusOptions]}
                className="w-full flex-wrap"
              />
            </fieldset>
          )}
          <p className="text-small text-ink-2">{t("onboarding.scalesIntro")}</p>
          {scalesFor(a.wineFocus).map(scale)}
          {error && (
            <p role="alert" className="text-small text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {onboarding && (
              <Button
                variant="ghost"
                loading={save.isPending}
                onClick={() =>
                  submit({
                    wineFocus: a.wineFocus,
                    body: null,
                    tannin: null,
                    sweetness: null,
                    acidity: null,
                  })
                }
              >
                {t("onboarding.skipRest")}
              </Button>
            )}
            <Button loading={save.isPending} onClick={() => submit(a)}>
              {t("save")}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
