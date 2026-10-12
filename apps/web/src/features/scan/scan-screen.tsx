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
import { placeLine } from "@/features/cellar/wine-visuals";
import { ApiError, errorMessage } from "@/lib/api";
import { UnreadablePhotoError } from "@/lib/photo";
import { Button } from "@/ui/button";
import { FileButton } from "@/ui/file-button";
import { PageHeader } from "@/ui/page-header";
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
  const te = useTranslations();
  const scan = useScan();
  const wines = useWines();
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
          <div role="status" className="flex flex-col items-center gap-5 py-4 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the photo just taken */}
            <img
              src={stage.preview}
              alt={t("photoAlt")}
              className="max-h-[50vh] w-auto max-w-full rounded-card border border-hairline object-contain"
            />
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
        <div role="alert" className="rounded-card border border-hairline bg-raised p-4">
          <p className="text-body text-ink">{error}</p>
          {retry && (
            <Button className="mt-3" size="md" onClick={() => onFile(retry)}>
              {t("tryAgain")}
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-col gap-3">
        <FileButton variant="primary" size="lg" block capture="environment" onFile={onFile}>
          {t("takePhoto")}
        </FileButton>
        <FileButton variant="secondary" size="lg" block onFile={onFile}>
          {t("choosePhoto")}
        </FileButton>
      </div>
      <p className="text-center text-small text-ink-2">{t("tips")}</p>
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
      <LabelImage
        image={result.image}
        size="photo"
        alt={t("photoAlt")}
        className="h-48 w-full rounded-card border border-hairline object-contain"
      />

      {!wantsForm && outcome === "found" && matches[0] && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="font-display text-headline">{t("foundTitle")}</h2>
            <p className="mt-1 text-body text-ink-2">{t("foundBody")}</p>
          </div>
          <Candidate wine={matches[0].wine} year={facts?.year ?? null} />
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
                <Candidate wine={m.wine} year={facts?.year ?? null} onPick={() => onWine(m.wine)} />
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
  onPick,
}: {
  wine: WineSummary;
  year: number | null;
  onPick?: () => void;
}) {
  const locale = useLocale();
  const body = (
    <>
      <span className="block truncate text-caption font-medium uppercase tracking-[0.12em] text-ink-3">
        {wine.producer}
      </span>
      <span className="block font-display text-title text-ink">{wine.name}</span>
      <span className="block text-small text-ink-2">
        {[
          year === null ? null : formatVintage(year),
          placeLine(wine.region, wine.countryCode, locale),
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </>
  );
  const frame = "block w-full rounded-card border border-hairline bg-surface p-4 text-left";
  return onPick ? (
    <button
      type="button"
      onClick={onPick}
      className={`${frame} transition-colors hover:bg-raised active:scale-[0.99]`}
    >
      {body}
    </button>
  ) : (
    <div className={frame}>{body}</div>
  );
}
