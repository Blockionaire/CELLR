"use client";

import { useLocale, useTranslations } from "next-intl";
import { currentValueCents, valuationKind, type VintageInsightView } from "@cellr/domain";
import { useInsight } from "@/features/insights/hooks";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Sheet } from "@/ui/sheet";
import { useMoney } from "./bottle-bits";
import { EYEBROW } from "./vintage-bits";
import { WorthFacts } from "./wine-insight";

type Kind = "own" | "market" | "offer" | "ai";

/** What the shown value rests on, in the same order of trust as `currentValueCents` picks it. */
function kindOf(view: VintageInsightView): Kind | null {
  if (view.myValueCents !== null) return "own";
  if (view.valuation) return valuationKind(view.valuation) === "market" ? "market" : "offer";
  return view.insight?.output.value ? "ai" : null;
}

/**
 * "Worth today", on a screen of its own (opened from the Waarde nu tile, like "Where is it?" from the Where tile):
 * the value, plainly marked as your own or as an estimate and how it was reached, its pages, when it was looked up
 * and (only when values were kept over time) how it went; then what was paid, kept apart, and what a bottle's value
 * depends on. Everything is what the page already knows: nothing is looked up or estimated here.
 */
export function ValueSheet({
  open,
  onClose,
  vintageId,
  title,
  currency,
  averagePriceCents,
  onManage,
}: {
  open: boolean;
  onClose: () => void;
  vintageId: string;
  title: string;
  currency: string;
  /** What the household paid per bottle on average (null when no price was kept). */
  averagePriceCents: number | null;
  /** To the page's own "Worth today", where the value is changed or looked up. */
  onManage: () => void;
}) {
  const t = useTranslations("insights");
  return (
    <Sheet open={open} onClose={onClose} title={t("valueTitle")} description={title}>
      {open && (
        <ValueBody
          vintageId={vintageId}
          currency={currency}
          averagePriceCents={averagePriceCents}
          onManage={onManage}
        />
      )}
    </Sheet>
  );
}

function ValueBody({
  vintageId,
  currency,
  averagePriceCents,
  onManage,
}: {
  vintageId: string;
  currency: string;
  averagePriceCents: number | null;
  onManage: () => void;
}) {
  const t = useTranslations("valueDetail");
  const ti = useTranslations("insights");
  const locale = useLocale();
  const { data } = useInsight(vintageId);
  const money = useMoney(data?.currency ?? currency);

  if (!data?.ready)
    return (
      <p role="status" className="py-6 text-center text-small text-ink-2">
        {t("loading")}
      </p>
    );
  const view: VintageInsightView = data;
  const worth = currentValueCents(view);
  const kind = kindOf(view);
  const delta =
    worth !== null && averagePriceCents !== null && averagePriceCents > 0
      ? (worth - averagePriceCents) / averagePriceCents
      : null;

  return (
    <div className="flex flex-col gap-6 pb-2" data-testid="value-detail">
      <section className="flex flex-col">
        {kind && (
          <span
            data-testid="value-kind"
            className={cn(
              "mb-3 self-start rounded-full border px-2.5 py-0.5 text-caption font-medium",
              kind === "own" ? "border-hairline text-ink-2" : "border-hairline text-bronze",
            )}
          >
            {t(`kind.${kind}`)}
          </span>
        )}
        <WorthFacts view={view} currency={currency} testIdPrefix="sheet-" />
        {kind && (
          <p className="mt-3 text-small text-ink-2" data-testid="value-method">
            {t(`method.${kind}`)}
          </p>
        )}
      </section>

      {averagePriceCents !== null && (
        <section
          className="flex flex-col gap-1 border-t border-hairline pt-5"
          data-testid="value-paid"
        >
          <h3 className={EYEBROW}>{t("paidTitle")}</h3>
          <p className="text-body text-ink tnum">
            {t("paidAverage", { price: money(averagePriceCents) })}
          </p>
          {delta !== null && Math.round(delta * 100) !== 0 && (
            <p className="text-small text-ink-2">
              <span className={cn("font-semibold tnum", delta > 0 ? "text-ok" : "text-danger")}>
                {new Intl.NumberFormat(locale, {
                  style: "percent",
                  signDisplay: "exceptZero",
                  maximumFractionDigits: 0,
                }).format(delta)}
              </span>{" "}
              {t(kind === "own" ? "diffOwn" : "diffEstimate")}
            </p>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2 border-t border-hairline pt-5">
        <h3 className={EYEBROW}>{t("factorsTitle")}</h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-ink marker:text-bronze">
          {(["producer", "vintage", "rarity", "condition", "channel"] as const).map((k) => (
            <li key={k}>{t(`factors.${k}`)}</li>
          ))}
        </ul>
        <p className="text-small text-ink-2">{t("notAnOffer")}</p>
      </section>

      <Button
        variant="secondary"
        onClick={onManage}
        className="self-start"
        data-testid="value-manage"
      >
        {worth === null ? ti("valueSet") : t("manage")}
      </Button>
    </div>
  );
}
