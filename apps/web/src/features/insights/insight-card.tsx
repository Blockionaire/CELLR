"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import {
  currentValueCents,
  ERROR_MESSAGES,
  parseMoneyToCents,
  type VintageInsightView,
} from "@cellr/domain";
import { useDay, useMoney } from "@/features/cellar/bottle-bits";
import { errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { useToast } from "@/ui/toast";
import { useGenerateInsight, useInsight, useSaveMyValue } from "./hooks";

/**
 * What the AI can tell about this wine, always labelled as its estimate, plus what a bottle is worth now:
 * your own number if you gave one, else the middle of the AI's range.
 */
export function InsightCard({ vintageId, currency }: { vintageId: string; currency: string }) {
  const t = useTranslations("insights");
  const te = useTranslations();
  const toast = useToast();
  const locale = useLocale();
  const day = useDay();
  const { data } = useInsight(vintageId);
  const generate = useGenerateInsight(vintageId);
  const saveValue = useSaveMyValue(vintageId);
  const money = useMoney(data?.currency ?? currency);
  const [editing, setEditing] = useState(false);
  const [valueText, setValueText] = useState("");
  const [valueError, setValueError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (!data) return null;
  const message = (e: unknown) => errorMessage(e, (k) => te(k), ERROR_MESSAGES);

  async function ask() {
    setFailure(null);
    try {
      await generate.mutateAsync();
    } catch (e) {
      setFailure(message(e));
    }
  }

  async function submitValue(event: FormEvent) {
    event.preventDefault();
    const parsed = parseMoneyToCents(valueText);
    if (parsed === undefined) return setValueError(t("valueError"));
    setValueError(null);
    try {
      await saveValue.mutateAsync(parsed);
      setEditing(false);
      toast.show(t("valueSaved"));
    } catch (e) {
      setValueError(message(e));
    }
  }

  const view: VintageInsightView = data;
  const out = view.insight?.output ?? null;
  const worth = currentValueCents(view);
  const startEdit = () => {
    setValueText(
      view.myValueCents === null
        ? ""
        : (view.myValueCents / 100).toFixed(2).replace(".", locale === "nl" ? "," : "."),
    );
    setValueError(null);
    setEditing(true);
  };

  return (
    <>
      <section
        className="rounded-card bg-surface shadow-raised ring-1 ring-hairline p-5"
        aria-labelledby="insight-title"
        data-testid="insight"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2
            id="insight-title"
            className="text-caption font-medium uppercase tracking-[0.14em] text-bronze"
          >
            {t("title")}
          </h2>
          {out && (
            <Button size="sm" variant="ghost" loading={generate.isPending} onClick={ask}>
              {t("refresh")}
            </Button>
          )}
        </div>

        {!view.ready ? (
          <p className="text-body text-ink-2">{t("notReady")}</p>
        ) : out ? (
          <div className="flex flex-col gap-4">
            <p className="text-body text-ink">{out.summary}</p>
            <dl className="flex flex-col gap-3">
              {out.style && <Row label={t("style")} value={out.style} />}
              {out.grapes.length > 0 && <Row label={t("grapes")} value={out.grapes.join(", ")} />}
              {out.tasting && <Row label={t("tasting")} value={out.tasting} />}
              {out.serving && (
                <Row
                  label={t("serving")}
                  value={t("servingValue", { min: out.serving.minC, max: out.serving.maxC })}
                />
              )}
              {out.decantMinutes !== null && (
                <Row
                  label={t("decant")}
                  value={
                    out.decantMinutes === 0
                      ? t("decantNone")
                      : t("decantValue", { minutes: out.decantMinutes })
                  }
                />
              )}
              {out.pairings.length > 0 && (
                <Row label={t("pairings")} value={out.pairings.join(", ")} />
              )}
              {out.aging && <Row label={t("aging")} value={out.aging} />}
            </dl>
            <p className="text-caption text-ink-2">
              {t("estimateNote", { level: t(`confidence.${out.confidence}`) })} ·{" "}
              {t("writtenOn", { day: day(view.insight!.generatedAt) })}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-body text-ink-2">{t("intro")}</p>
            <Button className="self-start" loading={generate.isPending} onClick={ask}>
              {generate.isPending ? t("thinking") : t("ask")}
            </Button>
          </div>
        )}
        {failure && (
          <p role="alert" className="mt-3 text-small text-danger">
            {failure}
          </p>
        )}
      </section>

      {view.ready && (
        <section
          className="rounded-card bg-surface shadow-raised ring-1 ring-hairline p-5"
          aria-labelledby="value-title"
          data-testid="value"
        >
          <h2
            id="value-title"
            className="mb-3 text-caption font-medium uppercase tracking-[0.14em] text-bronze"
          >
            {t("valueTitle")}
          </h2>
          {worth !== null ? (
            <>
              <p className="font-display text-headline tnum" data-testid="worth">
                {money(worth)} <span className="text-body text-ink-2">{t("perBottle")}</span>
              </p>
              <p className="mt-1 text-small text-ink-2">
                {view.myValueCents !== null
                  ? t("valueMine")
                  : out?.value
                    ? t("valueRange", {
                        low: money(out.value.lowCents),
                        high: money(out.value.highCents),
                      })
                    : ""}
              </p>
              {view.myValueCents === null && out?.value?.basis && (
                <p className="mt-1 text-caption text-ink-2">{out.value.basis}</p>
              )}
            </>
          ) : (
            <p className="text-body text-ink-2">{t("valueNone")}</p>
          )}

          {editing ? (
            <form onSubmit={submitValue} noValidate className="mt-4 flex flex-col gap-3">
              <Field
                inputClassName="rounded-full px-5"
                label={t("myValueLabel", { currency: view.currency })}
                hint={t("myValueHint")}
                inputMode="decimal"
                value={valueText}
                error={valueError}
                onChange={(e) => setValueText(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={saveValue.isPending}>
                  {t("valueSave")}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                  {t("valueCancel")}
                </Button>
                {view.myValueCents !== null && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => saveValue.mutate(null, { onSuccess: () => setEditing(false) })}
                  >
                    {t("valueClear")}
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <Button className="mt-4" size="sm" variant="secondary" onClick={startEdit}>
              {view.myValueCents === null ? t("valueSet") : t("valueChange")}
            </Button>
          )}
        </section>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-small text-ink-2">{label}</dt>
      <dd className="text-body text-ink sm:text-right">{value}</dd>
    </div>
  );
}
