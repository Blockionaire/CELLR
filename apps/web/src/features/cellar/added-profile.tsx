"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/ui/button";
import { useGenerateInsight, useInsight } from "@/features/insights/hooks";
import { useMoney } from "./bottle-bits";

/**
 * The last step after adding or scanning: the AI's profile of the wine, written by itself while the person
 * reads "added". Shows that it is working, then the short version; a button when it did not happen.
 */
export function AddedProfile({ vintageId }: { vintageId: string }) {
  const t = useTranslations("addBottle");
  const ti = useTranslations("insights");
  const { data } = useInsight(vintageId);
  const generate = useGenerateInsight(vintageId);
  // set by the add itself while the profile is being written in the background
  const { data: automatic } = useQuery({
    queryKey: ["insight-pending", vintageId],
    queryFn: () => false,
    enabled: false,
    initialData: false,
    staleTime: Infinity,
  });
  const money = useMoney(data?.currency ?? "EUR");
  const busy = generate.isPending || automatic === true;
  const out = data?.insight?.output ?? null;

  // The AI is switched off (database step not taken yet): say nothing rather than offer what cannot work.
  if (data && !data.ready) return null;

  return (
    <section
      data-testid="added-profile"
      aria-live="polite"
      className="w-full max-w-sm rounded-card bg-surface p-4 text-left shadow-raised ring-1 ring-hairline"
    >
      <p className="text-caption font-medium uppercase tracking-[0.12em] text-bronze">
        {t("profileTitle")}
      </p>
      {out ? (
        <div className="mt-2 flex flex-col gap-3">
          <p className="font-display text-title italic text-balance text-ink">{out.summary}</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small text-ink-2 tnum">
            {out.abvPercent !== null && <li>{ti("abvValue", { abv: out.abvPercent })}</li>}
            {out.drinkWindow && (
              <li>
                {t("profileWindow", { from: out.drinkWindow.from, until: out.drinkWindow.until })}
              </li>
            )}
            {out.value && (
              <li>
                {t("profileValue", {
                  value: money(Math.round((out.value.lowCents + out.value.highCents) / 2)),
                })}
              </li>
            )}
          </ul>
          <p className="text-caption text-ink-2">
            {ti("estimateNote", { level: ti(`confidence.${out.confidence}`) })}
          </p>
          <Link href={`/cellar/${vintageId}`} className="text-small font-semibold text-accent-fg">
            {t("profileOpen")}
          </Link>
        </div>
      ) : busy ? (
        <p className="mt-2 text-body text-ink-2">{ti("thinking")}</p>
      ) : (
        <div className="mt-2 flex flex-col items-start gap-3">
          <p className="text-body text-ink-2">{t("profileMissing")}</p>
          <Button size="sm" variant="secondary" onClick={() => generate.mutate()}>
            {ti("ask")}
          </Button>
        </div>
      )}
    </section>
  );
}
