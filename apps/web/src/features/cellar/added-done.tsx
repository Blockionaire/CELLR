"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatVintage, type AddBottlesResult } from "@cellr/domain";
import { Button, buttonStyles } from "@/ui/button";
import { CheckIcon } from "@/ui/icons";
import { AddedProfile } from "./added-profile";
import { WineStage } from "./wine-stage";

/** "Added 3 bottles of … to the Wine fridge": the same last screen after a manual add and after a scan. */
export function AddedDone({
  result,
  onAnother,
  anotherLabel,
}: {
  result: AddBottlesResult;
  onAnother: () => void;
  /** Overrides "Add another" (a scan says "Scan another"). */
  anotherLabel?: string | undefined;
}) {
  const t = useTranslations("addBottle");
  return (
    <div className="flex flex-col items-center gap-6 py-2 text-center">
      {/* The bottle on its stage, with a calm check and how many went in. */}
      <div className="relative w-full max-w-[16rem]">
        <WineStage
          type={result.wine.type}
          producer={result.wine.producer}
          name={result.wine.name}
          year={formatVintage(result.year)}
          size="hero"
        />
        <span
          aria-hidden="true"
          className="absolute left-3 top-3 rounded-full bg-surface px-3 py-1 text-small font-semibold text-ink shadow-raised tnum"
        >
          ×{result.bottleIds.length}
        </span>
        <span
          aria-hidden="true"
          className="glow absolute -right-2 -top-2 grid size-12 place-items-center rounded-full bg-accent text-accent-ink ring-4 ring-canvas"
        >
          <CheckIcon size={24} />
        </span>
      </div>
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
      <AddedProfile vintageId={result.vintageId} />
      <div className="flex w-full max-w-sm flex-col gap-3">
        <Button size="lg" block onClick={onAnother}>
          {anotherLabel ?? t("addAnother")}
        </Button>
        <Link
          href="/cellar"
          className={buttonStyles({ variant: "secondary", size: "lg", block: true })}
        >
          {t("seeCellar")}
        </Link>
      </div>
    </div>
  );
}
