"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { formatVintage, type AddBottlesResult, type WineSummary } from "@cellr/domain";
import { buttonStyles, Button } from "@/ui/button";
import { CheckIcon, ChevronRightIcon } from "@/ui/icons";
import { PageHeader } from "@/ui/page-header";
import { BottleDetails } from "./bottle-details";
import { ChooseWine } from "./choose-wine";
import { useWines } from "./hooks";
import { NewWineForm } from "./new-wine-form";

type Step = "choose" | "new" | "details" | "done";

/**
 * Pick the wine → say how many, which vintage, where → done. Two screens for the common case,
 * a third only when the wine is new. Everything you did is one tap from "Add another".
 */
export function AddBottleFlow({ currency }: { currency: string }) {
  const t = useTranslations("addBottle");
  const wines = useWines();
  const [step, setStep] = useState<Step>("choose");
  const [query, setQuery] = useState("");
  const [wine, setWine] = useState<WineSummary | null>(null);
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
            onChangeWine={() => setStep("choose")}
            onDone={(r, placeId) => {
              setResult(r);
              setLastPlace(placeId);
              setStep("done");
            }}
          />
        )}
        {step === "done" && result && (
          <div className="flex flex-col items-center gap-6 py-6 text-center">
            <span className="grid size-16 place-items-center rounded-full bg-accent text-accent-ink">
              <CheckIcon size={32} />
            </span>
            <div>
              <p className="font-display text-headline">
                {t("savedBottles", {
                  count: result.bottleIds.length,
                  wine: `${result.wine.producer} ${result.wine.name} ${formatVintage(result.year)}`,
                })}
              </p>
              <p className="mt-2 text-body text-ink-2">
                {result.placeLabel === null
                  ? t("placedNone")
                  : result.unplaced === 0
                    ? t("placedAll", { place: result.placeLabel })
                    : t("placedSome", {
                        placed: result.placed,
                        place: result.placeLabel,
                        unplaced: result.unplaced,
                      })}
              </p>
            </div>
            <div className="flex w-full flex-col gap-3">
              <Button size="lg" block onClick={reset}>
                {t("addAnother")}
              </Button>
              <Link
                href="/cellar"
                className={buttonStyles({ variant: "secondary", size: "lg", block: true })}
              >
                {t("seeCellar")}
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
