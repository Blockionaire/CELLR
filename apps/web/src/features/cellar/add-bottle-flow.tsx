"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { AddBottlesResult, WineSummary } from "@cellr/domain";
import { Button } from "@/ui/button";
import { ChevronRightIcon } from "@/ui/icons";
import { PageHeader } from "@/ui/page-header";
import { AddedDone } from "./added-done";
import { BottleDetails } from "./bottle-details";
import { ChooseWine } from "./choose-wine";
import { useWines } from "./hooks";
import { NewWineForm } from "./new-wine-form";

type Step = "choose" | "new" | "details" | "done";

/**
 * Pick the wine → say how many, which vintage, where → done. Two screens for the common case,
 * a third only when the wine is new. Everything you did is one tap from "Add another".
 */
export function AddBottleFlow({
  currency,
  initialWine,
  initialYear,
}: {
  currency: string;
  /** Jump straight to "how many and where" for this wine (from "Add more"). */
  initialWine?: WineSummary | undefined;
  initialYear?: number | null | undefined;
}) {
  const t = useTranslations("addBottle");
  const wines = useWines();
  const [step, setStep] = useState<Step>(initialWine ? "details" : "choose");
  const [query, setQuery] = useState("");
  const [wine, setWine] = useState<WineSummary | null>(initialWine ?? null);
  const [result, setResult] = useState<AddBottlesResult | null>(null);
  const [lastPlace, setLastPlace] = useState<string | null | undefined>(undefined);

  // Move focus to the new step's heading so keyboard and screen-reader users land in the right place.
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const title =
    step === "choose"
      ? t("chooseTitle")
      : step === "new"
        ? t("newTitle")
        : step === "details"
          ? t("detailsTitle")
          : t("savedTitle");

  const back =
    step === "new" ? () => setStep("choose") : step === "details" ? () => setStep("choose") : null;

  function pick(next: WineSummary) {
    setWine(next);
    setStep("details");
  }

  function reset() {
    setWine(null);
    setResult(null);
    setQuery("");
    setStep("choose");
  }

  return (
    <>
      <div ref={heading} tabIndex={-1} className="outline-none">
        <PageHeader
          eyebrow={t("eyebrow")}
          title={title}
          actions={
            back && (
              <Button variant="ghost" size="sm" onClick={back}>
                <ChevronRightIcon size={18} className="rotate-180" />
                {t("back")}
              </Button>
            )
          }
        />
      </div>

      <div className="mx-auto w-full max-w-xl">
        {step === "choose" && (
          <ChooseWine
            wines={wines.data}
            query={query}
            onQuery={setQuery}
            onPick={pick}
            onNew={() => setStep("new")}
          />
        )}
        {step === "new" && (
          <NewWineForm
            initialName={query.trim()}
            producers={[...new Set((wines.data ?? []).map((w) => w.producer))]}
            onCreated={pick}
          />
        )}
        {step === "details" && wine && (
          <BottleDetails
            wine={wine}
            currency={currency}
            preferredPlaceId={lastPlace}
            initialYear={result === null && wine.id === initialWine?.id ? initialYear : undefined}
            onChangeWine={() => setStep("choose")}
            onDone={(r, placeId) => {
              setResult(r);
              setLastPlace(placeId);
              setStep("done");
            }}
          />
        )}
        {step === "done" && result && <AddedDone result={result} onAnother={reset} />}
      </div>
    </>
  );
}
