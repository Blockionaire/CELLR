"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  ERROR_MESSAGES,
  formatVintage,
  suggestWine,
  type AddBottlesResult,
  type ScanResult,
  type WineSummary,
} from "@cellr/domain";
import { AddedDone } from "@/features/cellar/added-done";
import { BottleDetails } from "@/features/cellar/bottle-details";
import { useWines } from "@/features/cellar/hooks";
import { LabelImage } from "@/features/cellar/label-image";
import { NewWineForm } from "@/features/cellar/new-wine-form";
import { useOwnedCounts, WineChoice } from "@/features/cellar/wine-stage";
import { placeLine } from "@/features/cellar/wine-visuals";
import { ApiError, errorMessage } from "@/lib/api";
import { UnreadablePhotoError } from "@/lib/photo";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { FileButton } from "@/ui/file-button";
import { CheckIcon } from "@/ui/icons";
import { PageHeader } from "@/ui/page-header";
import { useAddWish } from "@/features/wishlist/hooks";
import { useScan } from "./hooks";

type Stage =
  | { name: "capture"; error: string | null; retry: File | null }
  | { name: "reading"; preview: string }
  | { name: "review"; result: ScanResult }
  | { name: "details"; result: ScanResult; wine: WineSummary }
  | { name: "done"; result: AddBottlesResult };

/**
 * Scan a label: take a photo, we read it, you check it, the bottles are added with the photo on them. The
 * photo is kept the moment it is taken, so whatever goes wrong afterwards (no AI, no connection, a label that
 * cannot be read) never costs the person their picture: the wine can always be filled in by hand beside it.
 */
export function ScanScreen({ currency }: { currency: string }) {
  const t = useTranslations("scan");
  const tAdd = useTranslations("addBottle");
  const tWish = useTranslations("wishlist");
  const te = useTranslations();
  const scan = useScan();
  const wines = useWines();
  const addWish = useAddWish();
  const [stage, setStage] = useState<Stage>({ name: "capture", error: null, retry: null });
  // In a "found" review, "not this one" turns the screen into the new-wine form.
  const [rejectedFound, setRejectedFound] = useState(false);
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [stage.name]);

  // The local preview of the photo lives only while it is being read.
  const preview = stage.name === "reading" ? stage.preview : null;
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  async function read(file: File) {
    setRejectedFound(false);
    setStage({ name: "reading", preview: URL.createObjectURL(file) });
    try {
      setStage({ name: "review", result: await scan.mutateAsync(file) });
    } catch (e) {
      const message =
        e instanceof UnreadablePhotoError
          ? te("photo.unreadable")
          : e instanceof ApiError && e.code === "NETWORK"
            ? t("noConnection")
            : errorMessage(e, (k) => te(k), ERROR_MESSAGES);
      setStage({ name: "capture", error: message, retry: file });
    }
  }

  const restart = () => {
    setRejectedFound(false);
    setStage({ name: "capture", error: null, retry: null });
  };

  return (
    <>
      <div ref={heading} tabIndex={-1} className="outline-none">
        <PageHeader
          title={
            stage.name === "details"
              ? tAdd("detailsTitle")
              : stage.name === "done"
                ? tAdd("savedTitle")
                : t("title")
          }
        />
      </div>
      <div className="mx-auto w-full max-w-xl">
        {stage.name === "capture" && (
          <Capture error={stage.error} retry={stage.retry} onFile={read} />
        )}

        {stage.name === "reading" && (
          <div role="status" className="flex flex-col items-center gap-5 py-2 text-center">
            <div className="w-full rounded-[28px] bg-hero p-5 shadow-raised">
              <div className="relative mx-auto w-fit max-w-full">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the photo just taken */}
                <img
                  src={stage.preview}
                  alt={t("photoAlt")}
                  className="max-h-[50vh] w-auto max-w-full rounded-[16px] object-contain"
                />
                {/* A calm sheen over the photo while it is read (still when motion is reduced). */}
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-[16px] bg-gradient-to-b from-transparent via-white/25 to-transparent motion-safe:animate-pulse"
                />
                <FramingGuide className="-inset-2.5" />
              </div>
            </div>
            <div>
              <p className="font-display text-headline motion-safe:animate-pulse">{t("reading")}</p>
              <p className="mt-1 text-body text-ink-2">{t("readingHint")}</p>
            </div>
          </div>
        )}

        {stage.name === "review" && (
          <Review
            result={stage.result}
            rejectedFound={rejectedFound}
            producers={[...new Set((wines.data ?? []).map((w) => w.producer))]}
            onReject={() => setRejectedFound(true)}
            onWine={(wine) => setStage({ name: "details", result: stage.result, wine })}
            onAgain={restart}
          />
        )}

        {stage.name === "details" && (
          <BottleDetails
            wine={stage.wine}
            currency={currency}
            preferredPlaceId={undefined}
            initialYear={
              stage.result.facts?.nonVintage ? null : (stage.result.facts?.year ?? undefined)
            }
            imageId={stage.result.image.id}
            footer={
              <Button
                type="button"
                variant="ghost"
                size="lg"
                block
                loading={addWish.isPending}
                onClick={async () => {
                  try {
                    await addWish.mutateAsync({
                      wineId: stage.wine.id,
                      year: stage.result.facts?.nonVintage
                        ? null
                        : (stage.result.facts?.year ?? null),
                      note: null,
                      maxPriceCents: null,
                    });
                    restart();
                  } catch {
                    // The hook has said what went wrong (for instance, that it is on the list already).
                  }
                }}
              >
                {tWish("saveFromScan")}
              </Button>
            }
            onChangeWine={() => setStage({ name: "review", result: stage.result })}
            onDone={(result) => setStage({ name: "done", result })}
          />
        )}

        {stage.name === "done" && (
          <AddedDone result={stage.result} onAnother={restart} anotherLabel={t("another")} />
        )}
      </div>
    </>
  );
}

/** Four gold corner brackets: the frame a label should fill. Decorative. */
function FramingGuide({ className }: { className?: string }) {
  const corner = "absolute size-9 border-hero-gold";
  return (
    <span aria-hidden="true" className={cn("pointer-events-none absolute", className)}>
      <span
        className={cn(corner, "left-0 top-0 rounded-tl-[28px] border-l-[3px] border-t-[3px]")}
      />
      <span
        className={cn(corner, "right-0 top-0 rounded-tr-[28px] border-r-[3px] border-t-[3px]")}
      />
      <span
        className={cn(corner, "bottom-0 left-0 rounded-bl-[28px] border-b-[3px] border-l-[3px]")}
      />
      <span
        className={cn(corner, "bottom-0 right-0 rounded-br-[28px] border-b-[3px] border-r-[3px]")}
      />
    </span>
  );
}

function Capture({
  error,
  retry,
  onFile,
}: {
  error: string | null;
  retry: File | null;
  onFile: (file: File) => void;
}) {
  const t = useTranslations("scan");
  return (
    <div className="flex flex-col gap-5">
      <p className="text-body text-ink-2">{t("intro")}</p>
      {error && (
        <div role="alert" className="rounded-card bg-raised p-4 ring-1 ring-hairline">
          <p className="text-body text-ink">{error}</p>
          {retry && (
            <Button className="mt-3" size="md" onClick={() => onFile(retry)}>
              {t("tryAgain")}
            </Button>
          )}
        </div>
      )}
      {/* The viewfinder: a dark camera area with a framing guide, the shutter and the library below. */}
      <div className="overflow-hidden rounded-[28px] bg-hero text-hero-ink shadow-raised">
        <div className="relative aspect-[5/6] sm:aspect-[4/3]">
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/40"
          />
          <FramingGuide className="inset-x-[15%] inset-y-[10%] rounded-[28px] ring-1 ring-white/15" />
          <p className="absolute inset-x-8 bottom-5 text-center text-small text-hero-ink/85">
            {t("tips")}
          </p>
        </div>
        <div className="flex flex-col items-center gap-4 px-5 pb-6 pt-2">
          <span className="grid size-[5.5rem] place-items-center rounded-full ring-[3px] ring-white/80">
            <FileButton
              variant="primary"
              size="lg"
              capture="environment"
              onFile={onFile}
              className="size-[4.5rem] p-0 ring-2 ring-white/30"
            >
              <span className="sr-only">{t("takePhoto")}</span>
            </FileButton>
          </span>
          <FileButton
            variant="secondary"
            size="md"
            onFile={onFile}
            className="bg-white/15 text-hero-ink hover:bg-white/25"
          >
            {t("choosePhoto")}
          </FileButton>
        </div>
      </div>
      <p className="text-center text-caption text-ink-3">{t("privacy")}</p>
    </div>
  );
}

function Review({
  result,
  rejectedFound,
  producers,
  onReject,
  onWine,
  onAgain,
}: {
  result: ScanResult;
  rejectedFound: boolean;
  producers: string[];
  onReject: () => void;
  onWine: (wine: WineSummary) => void;
  onAgain: () => void;
}) {
  const t = useTranslations("scan");
  const owned = useOwnedCounts();
  const [chosenNew, setChosenNew] = useState(false);
  const { outcome, facts, matches } = result;
  const wantsForm =
    chosenNew ||
    outcome === "new" ||
    outcome === "unread" ||
    (outcome === "found" && rejectedFound);
  const unsure = facts ? Object.values(facts.confidence).includes("low") : false;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-[28px] bg-hero p-3 shadow-raised">
        <LabelImage
          image={result.image}
          size="photo"
          alt={t("photoAlt")}
          className="h-44 w-full rounded-[16px] object-contain"
        />
      </div>

      {!wantsForm && outcome === "found" && matches[0] && (
        <section className="flex flex-col gap-4 rounded-card bg-surface p-4 shadow-raised ring-1 ring-hairline">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-accent text-accent-ink"
            >
              <CheckIcon size={16} />
            </span>
            <div>
              <h2 className="font-display text-headline">{t("foundTitle")}</h2>
              <p className="mt-1 text-body text-ink-2">{t("foundBody")}</p>
            </div>
          </div>
          <Candidate
            wine={matches[0].wine}
            year={facts?.year ?? null}
            owned={owned.get(matches[0].wine.id)}
          />
          <Button size="lg" block onClick={() => onWine(matches[0]!.wine)}>
            {t("confirmFound")}
          </Button>
          <Button variant="ghost" size="lg" block onClick={onReject}>
            {t("notThisOne")}
          </Button>
        </section>
      )}

      {!wantsForm && outcome === "choose" && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="font-display text-headline">{t("chooseTitle")}</h2>
            <p className="mt-1 text-body text-ink-2">{t("chooseBody")}</p>
          </div>
          <ul className="flex flex-col gap-3">
            {matches.map((m) => (
              <li key={m.wine.id}>
                <Candidate
                  wine={m.wine}
                  year={facts?.year ?? null}
                  owned={owned.get(m.wine.id)}
                  onPick={() => onWine(m.wine)}
                />
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="lg" block onClick={() => setChosenNew(true)}>
            {t("noneOfThese")}
          </Button>
        </section>
      )}

      {wantsForm && (
        <section className="flex flex-col gap-4">
          {outcome === "unread" ? (
            <div role="status">
              <h2 className="font-display text-headline">{t("unreadTitle")}</h2>
              <p className="mt-1 text-body text-ink-2">
                {t(`unread.${result.reason ?? "ai-down"}`)}
              </p>
            </div>
          ) : (
            <div>
              <h2 className="font-display text-headline">{t("newTitle")}</h2>
              <p className="mt-1 text-body text-ink-2">{t("newBody")}</p>
              {unsure && <p className="mt-2 text-small text-ink">{t("hardToRead")}</p>}
              {facts && facts.type === null && (
                <p className="mt-2 text-small text-ink">{t("typeUnclear")}</p>
              )}
            </div>
          )}
          <NewWineForm
            initialName=""
            draft={facts ? suggestWine(facts) : undefined}
            producers={producers}
            onCreated={onWine}
          />
          <Button variant="ghost" size="lg" block onClick={onAgain}>
            {t("tryAnother")}
          </Button>
        </section>
      )}
    </div>
  );
}

function Candidate({
  wine,
  year,
  owned,
  onPick,
}: {
  wine: WineSummary;
  year: number | null;
  owned?: number | undefined;
  onPick?: () => void;
}) {
  const locale = useLocale();
  const detail = [
    year === null ? null : formatVintage(year),
    placeLine(wine.region, wine.countryCode, locale),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <WineChoice
      wine={wine}
      detail={detail}
      owned={owned}
      onPick={onPick}
      size={onPick ? "thumb" : "card"}
    />
  );
}
