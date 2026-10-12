"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatVintage, type AddBottlesResult } from "@cellr/domain";
import { Button, buttonStyles } from "@/ui/button";
import { CheckIcon } from "@/ui/icons";

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
