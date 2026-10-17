"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  currentValueCents,
  ERROR_MESSAGES,
  parseMoneyToCents,
  type InsightOutput,
  type VintageInsightView,
} from "@cellr/domain";
import { useGenerateInsight, useInsight, useSaveMyValue } from "@/features/insights/hooks";
import { errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { useToast } from "@/ui/toast";
import { useDay, useMoney } from "./bottle-bits";
import { EYEBROW, Section, Tag } from "./vintage-bits";

/**
 * What the AI can tell about this wine, always labelled as its estimate, above the plain facts the page knows
 * (`children`). The AI's profile is text and lists only (style, grapes, pairings, ageing): it has no numeric taste
 * scores, so nothing here is drawn as a chart.
 */
export function AboutSection({
  vintageId,
  title,
  children,
}: {
  vintageId: string;
  title: string;
  /** The wine's own facts (style, region…), shown under the profile. */
  children: ReactNode;
}) {
  const t = useTranslations("insights");
  const te = useTranslations();
  const day = useDay();
  const { data } = useInsight(vintageId);
  const generate = useGenerateInsight(vintageId);
  const [failure, setFailure] = useState<string | null>(null);

  const view: VintageInsightView | undefined = data;
  const out = view?.insight?.output ?? null;

  async function ask() {
    setFailure(null);
    try {
      await generate.mutateAsync();
    } catch (e) {
      setFailure(errorMessage(e, (k) => te(k), ERROR_MESSAGES));
    }
  }

  return (
    <Section
      title={title}
      action={
        out ? (
          <Button size="sm" variant="ghost" loading={generate.isPending} onClick={ask}>
            {t("refresh")}
          </Button>
        ) : undefined
      }
    >
      {view && (
        <div data-testid="insight" className="flex flex-col gap-5">
          {!view.ready ? (
            <p className="text-body text-ink-2">{t("notReady")}</p>
          ) : out ? (
            <>
              <Profile out={out} />
              <p className="text-caption text-ink-2">
                {t("estimateNote", { level: t(`confidence.${out.confidence}`) })} ·{" "}
                {t("writtenOn", { day: day(view.insight!.generatedAt) })}
              </p>
            </>
          ) : (
            <div className="flex flex-col items-start gap-3">
              <p className="text-body text-ink-2">{t("intro")}</p>
              <Button variant="secondary" loading={generate.isPending} onClick={ask}>
                {generate.isPending ? t("thinking") : t("ask")}
              </Button>
            </div>
          )}
          {failure && (
            <p role="alert" className="text-small text-danger">
              {failure}
            </p>
          )}
        </div>
      )}
      {view && <hr className="my-4 border-hairline" />}
      {children}
    </Section>
  );
}

function Profile({ out }: { out: InsightOutput }) {
  const t = useTranslations("insights");
  return (
    <>
      <p className="font-display text-title italic text-balance text-ink">{out.summary}</p>
      <dl className="flex flex-col gap-4">
        {out.style && <Line label={t("style")}>{out.style}</Line>}
        {out.tasting && <Line label={t("tasting")}>{out.tasting}</Line>}
        {out.grapes.length > 0 && (
          <Line label={t("grapes")}>
            <Tags items={out.grapes} />
          </Line>
        )}
        {out.pairings.length > 0 && (
          <Line label={t("pairings")}>
            <Tags items={out.pairings} />
          </Line>
        )}
      </dl>
      {(out.serving || out.decantMinutes !== null || out.abvPercent !== null) && (
        <dl className="grid grid-cols-2 gap-3">
          {out.abvPercent !== null && (
            <Stat label={t("abv")}>{t("abvValue", { abv: out.abvPercent })}</Stat>
          )}
          {out.serving && (
            <Stat label={t("serving")}>
              {t("servingValue", { min: out.serving.minC, max: out.serving.maxC })}
            </Stat>
          )}
          {out.decantMinutes !== null && (
            <Stat label={t("decant")}>
              {out.decantMinutes === 0
                ? t("decantNone")
                : t("decantValue", { minutes: out.decantMinutes })}
            </Stat>
          )}
        </dl>
      )}
      {out.aging && (
        <dl>
          <Line label={t("aging")}>{out.aging}</Line>
        </dl>
      )}
    </>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className={EYEBROW}>{label}</dt>
      <dd className="mt-1 text-body text-ink">{children}</dd>
    </div>
  );
}

function Tags({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-1.5 flex flex-wrap gap-2">
      {items.map((item, i) => (
        <Tag key={item} last={i === items.length - 1}>
          {item}
        </Tag>
      ))}
    </ul>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-[16px] bg-raised p-3">
      <dt className="text-caption text-ink-2">{label}</dt>
      <dd className="mt-0.5 font-display text-title tnum text-ink">{children}</dd>
    </div>
  );
}

/**
 * What a bottle is worth now: your own number if you gave one, else the middle of the AI's range. Nothing at all
 * until the database step for this has been taken.
 */
export function WorthSection({ vintageId, currency }: { vintageId: string; currency: string }) {
  const t = useTranslations("insights");
  const te = useTranslations();
  const toast = useToast();
  const locale = useLocale();
  const { data } = useInsight(vintageId);
  const saveValue = useSaveMyValue(vintageId);
  const money = useMoney(data?.currency ?? currency);
  const [editing, setEditing] = useState(false);
  const [valueText, setValueText] = useState("");
  const [valueError, setValueError] = useState<string | null>(null);

  if (!data?.ready) return null;
  const view: VintageInsightView = data;
  const out = view.insight?.output ?? null;
  const worth = currentValueCents(view);
  const message = (e: unknown) => errorMessage(e, (k) => te(k), ERROR_MESSAGES);

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
    <Section title={t("valueTitle")} testId="value">
      {worth !== null ? (
        <>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-display tnum text-ink" data-testid="worth">
              {money(worth)}
            </span>
            <span className="text-body text-ink-2">{t("perBottle")}</span>
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
    </Section>
  );
}
