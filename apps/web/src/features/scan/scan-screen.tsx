"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  ERROR_MESSAGES,
  formatVintage,
  matchLabel,
  suggestWine,
  type AddBottlesResult,
  type ScanResult,
  type WineSummary,
} from "@cellr/domain";
import { CatalogScanNote } from "@/features/account/catalog-section";
import { AddedDone } from "@/features/cellar/added-done";
import { BottleDetails } from "@/features/cellar/bottle-details";
import { ChooseWine } from "@/features/cellar/choose-wine";
import {
  attachBackLabel,
  useWines,
  winesKey,
  type BackLabelOutcome,
} from "@/features/cellar/hooks";
import { LabelImage } from "@/features/cellar/label-image";
import { NewWineForm } from "@/features/cellar/new-wine-form";
import { useOwnedCounts, WineChoice } from "@/features/cellar/wine-stage";
import { placeLine } from "@/features/cellar/wine-visuals";
import { ApiError, errorMessage } from "@/lib/api";
import { UnreadablePhotoError, type PreparedPhoto } from "@/lib/photo";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { CheckIcon, SearchIcon } from "@/ui/icons";
import { PageHeader } from "@/ui/page-header";
import { useToast } from "@/ui/toast";
import { useAddWish } from "@/features/wishlist/hooks";
import { useCamera, type Camera } from "./camera";
import { BackLabelPicker, BackLabelResult } from "./back-label";
import { useScan } from "./hooks";
import { ModeBar, type ScanMode } from "./modes";
import { SeriesTray, useScanSeries, type SeriesItem } from "./series";

type Stage =
  | { name: "capture"; error: string | null; retry: File | null }
  | { name: "reading"; preview: string }
  // `itemId`: the photo came from a series (several bottles in a row), see series.tsx
  | { name: "review"; result: ScanResult; itemId?: string | undefined }
  | { name: "details"; result: ScanResult; wine: WineSummary; itemId?: string | undefined }
  | {
      name: "done";
      result: AddBottlesResult;
      /** A back label taken with this scan, and what became of it. */
      back?: { photo: PreparedPhoto; outcome: BackLabelOutcome | "saving" } | undefined;
    };

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
  const queryClient = useQueryClient();
  const addWish = useAddWish();
  const toast = useToast();
  const [mode, setMode] = useState<ScanMode>("single");
  // In a series the place chosen for one bottle is offered for the next.
  const [lastPlace, setLastPlace] = useState<string | null | undefined>(undefined);
  const [stage, setStage] = useState<Stage>({ name: "capture", error: null, retry: null });
  // In a "found" review, "not this one" turns the screen into the new-wine form.
  const [rejectedFound, setRejectedFound] = useState(false);
  // An optional back label, tied to the front photo it was taken with: it can never go on to another wine.
  const [back, setBack] = useState<{ imageId: string; photo: PreparedPhoto } | null>(null);
  const backFor = (imageId: string) => (back?.imageId === imageId ? back.photo : null);
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A step that puts the cursor in its first field (search, producer) keeps it: that is where the keyboard
    // belongs on a phone. Otherwise the heading takes focus.
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    heading.current?.focus();
  }, [stage.name]);

  // The local preview of the photo lives only while it is being read.
  const preview = stage.name === "reading" ? stage.preview : null;
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const describe = useCallback(
    (e: unknown) =>
      e instanceof UnreadablePhotoError
        ? te("photo.unreadable")
        : e instanceof ApiError && e.code === "NETWORK"
          ? t("noConnection")
          : errorMessage(e, (k) => te(k), ERROR_MESSAGES),
    [t, te],
  );
  const { mutateAsync: readLabel } = scan;
  const series = useScanSeries(readLabel, describe);
  // The camera belongs to the screen, not the viewfinder: going from a photo to its review and back does not
  // ask for the camera again (see camera.ts).
  const camera = useCamera(stage.name === "capture");

  /**
   * A photo read a while ago is matched again against the wines as they are now: a wine added from an earlier
   * photo of this batch is then found, instead of being offered as a new wine a second time.
   */
  const current = (result: ScanResult): ScanResult => {
    // Read from the cache, not this render: right after a wine is added, the list is fresher there.
    const list = queryClient.getQueryData<WineSummary[]>(winesKey) ?? wines.data;
    // A remembered photo already names the wine this household confirmed for it.
    if (!result.facts || result.outcome === "unread" || result.remembered || !list) return result;
    return { ...result, ...matchLabel(result.facts, list) };
  };

  /** A batch photo to look at: one we are sure of goes straight to its bottles (the row was the check). */
  function open(item: SeriesItem) {
    if (!item.result) return;
    setRejectedFound(false);
    const result = current(item.result);
    const sure =
      result.outcome === "found" &&
      result.matches[0] &&
      result.facts &&
      !Object.values(result.facts.confidence).includes("low");
    setStage(
      sure
        ? { name: "details", result, wine: result.matches[0]!.wine, itemId: item.id }
        : { name: "review", result, itemId: item.id },
    );
  }

  async function addToBatch(files: File[]) {
    const { refused } = await series.queue.add(files);
    if (refused > 0) toast.show(t("series.full", { count: refused }));
  }

  async function read(file: File) {
    setRejectedFound(false);
    setStage({ name: "reading", preview: URL.createObjectURL(file) });
    try {
      setStage({ name: "review", result: await readLabel(file) });
    } catch (e) {
      setStage({ name: "capture", error: describe(e), retry: file });
    }
  }

  /**
   * One photo of a series is handled: say so (unless something already did), then straight on to the next one
   * that is ready (if any).
   */
  function handled(itemId: string, outcome: string, said = false) {
    // Once only: a second save of the same photo (a double tap) changes nothing.
    if (!series.queue.finish(itemId, outcome)) return;
    if (!said) toast.show(outcome);
    next(itemId);
  }

  /** On to the next photo that is ready, or back to the batch. */
  function next(afterId: string) {
    setRejectedFound(false);
    const item = series.queue.nextReady(afterId);
    if (item) open(item);
    else setStage({ name: "capture", error: null, retry: null });
  }

  function skip(itemId: string) {
    series.queue.skip(itemId);
    toast.show(t("series.skipped"));
    next(itemId);
  }

  const restart = () => {
    setRejectedFound(false);
    setBack(null);
    setStage({ name: "capture", error: null, retry: null });
  };

  return (
    <>
      <div
        ref={heading}
        tabIndex={-1}
        className={cn("outline-none", stage.name === "capture" && "pt-4 lg:pt-10")}
      >
        {stage.name !== "capture" && (
          <PageHeader
            title={
              stage.name === "details"
                ? tAdd("detailsTitle")
                : stage.name === "done"
                  ? tAdd("savedTitle")
                  : t("title")
            }
          />
        )}
      </div>
      <div className="mx-auto w-full max-w-xl">
        {stage.name === "capture" && (
          <div className="flex flex-col gap-6">
            <Capture
              camera={camera}
              error={stage.error}
              retry={stage.retry}
              mode={mode}
              onMode={setMode}
              onFiles={(files) =>
                mode === "batch" ? void addToBatch(files) : files[0] && void read(files[0])
              }
              series={{ total: series.summary.total, done: series.summary.added }}
            />
            <SeriesTray
              items={series.items}
              paused={series.paused}
              onOpen={open}
              onRetry={(item) => series.queue.retry(item.id)}
              onRemove={(item) => series.queue.remove(item.id)}
              onSkip={(item) => series.queue.skip(item.id)}
              onReadAnyway={(item) => series.queue.readAnyway(item.id)}
              onResume={() => series.queue.resume()}
              onNewBatch={() => series.queue.clear()}
            />
          </div>
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
            wines={wines.data ?? []}
            onReject={() => setRejectedFound(true)}
            onWine={(wine) =>
              setStage({ name: "details", result: stage.result, wine, itemId: stage.itemId })
            }
            onAgain={restart}
            batch={
              stage.itemId
                ? {
                    onBack: () => setStage({ name: "capture", error: null, retry: null }),
                    onSkip: () => skip(stage.itemId!),
                  }
                : undefined
            }
          />
        )}

        {stage.name === "details" && (
          <BottleDetails
            // A fresh form per photo: going straight on to the next one never carries its vintage over.
            key={`${stage.result.image.id}:${stage.wine.id}`}
            wine={stage.wine}
            currency={currency}
            preferredPlaceId={stage.itemId ? lastPlace : undefined}
            initialQuantity={mode === "same" && !stage.itemId ? 2 : 1}
            quantityHint={mode === "same" && !stage.itemId ? t("modes.sameQuantity") : undefined}
            initialYear={
              stage.result.facts?.nonVintage ? null : (stage.result.facts?.year ?? undefined)
            }
            imageId={stage.result.image.id}
            labels={
              <BackLabelPicker
                frontImageId={stage.result.image.id}
                value={backFor(stage.result.image.id)}
                onChange={(photo) =>
                  setBack(photo ? { imageId: stage.result.image.id, photo } : null)
                }
              />
            }
            footer={
              <Button
                type="button"
                variant="ghost"
                size="lg"
                block
                loading={addWish.isPending}
                onClick={async () => {
                  if (addWish.isPending) return;
                  try {
                    await addWish.mutateAsync({
                      wineId: stage.wine.id,
                      year: stage.result.facts?.nonVintage
                        ? null
                        : (stage.result.facts?.year ?? null),
                      note: null,
                      maxPriceCents: null,
                    });
                    if (stage.itemId)
                      handled(
                        stage.itemId,
                        t("series.wished", { wine: `${stage.wine.producer} ${stage.wine.name}` }),
                        true, // the wishlist has said so already
                      );
                    else restart();
                  } catch {
                    // The hook has said what went wrong (for instance, that it is on the list already).
                  }
                }}
              >
                {tWish("saveFromScan")}
              </Button>
            }
            onChangeWine={() =>
              setStage({ name: "review", result: stage.result, itemId: stage.itemId })
            }
            onDone={(result, placeId) => {
              // The bottles are in. The back label (if any) follows on its own: whatever happens to it, the
              // bottles stay added, and the photo is only uploaded now, so leaving earlier left nothing behind.
              const photo = backFor(stage.result.image.id);
              setBack(null);
              const sent = photo ? attachBackLabel(result.vintageId, photo) : null;
              if (!stage.itemId) {
                setStage({
                  name: "done",
                  result,
                  back: photo ? { photo, outcome: "saving" } : undefined,
                });
                void sent?.then((outcome) =>
                  setStage((s) =>
                    s.name === "done" && s.result === result && s.back
                      ? { ...s, back: { ...s.back, outcome } }
                      : s,
                  ),
                );
                return;
              }
              // In a series nothing waits: an existing back label is kept, a failure is said.
              void sent?.then((outcome) => {
                const wine = `${result.wine.producer} ${result.wine.name}`;
                if (outcome === "exists") toast.show(te("photo.backKeptFor", { wine }));
                if (outcome === "failed")
                  toast.show(te("photo.backFailedFor", { wine }), { tone: "error" });
              });
              setLastPlace(placeId);
              handled(
                stage.itemId,
                t("series.added", {
                  count: result.bottleIds.length,
                  wine: `${result.wine.producer} ${result.wine.name} ${formatVintage(result.year)}`,
                }),
              );
            }}
          />
        )}

        {stage.name === "done" && stage.back && (
          <BackLabelResult
            vintageId={stage.result.vintageId}
            photo={stage.back.photo}
            initial={stage.back.outcome}
          />
        )}
        {stage.name === "done" && (
          <AddedDone
            result={stage.result}
            onAnother={restart}
            anotherLabel={t("another")}
            hasPhoto
          />
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
  camera,
  error,
  retry,
  mode,
  onMode,
  onFiles,
  series,
}: {
  camera: Camera;
  error: string | null;
  retry: File | null;
  mode: ScanMode;
  onMode: (mode: ScanMode) => void;
  onFiles: (files: File[]) => void;
  /** Photos of a batch so far: how many, and how many are added. */
  series: { total: number; done: number };
}) {
  const t = useTranslations("scan");
  const { attach, state: cameraState, capture, start, retry: retryCamera } = camera;
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState(0);
  const live = cameraState === "live";
  const batch = mode === "batch";

  const pick = (multiple: boolean) => (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = ""; // choosing the same file again must work
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  };

  async function shoot() {
    // Without the live picture (not asked for, refused, none) the phone's own camera takes the photo.
    if (!live) return cameraInput.current?.click();
    const file = await capture();
    if (!file) return cameraInput.current?.click();
    navigator.vibrate?.(12);
    setFlash((n) => n + 1);
    onFiles([file]);
  }

  const status =
    cameraState === "idle"
      ? t("camera.idle")
      : cameraState === "starting"
        ? t("camera.starting")
        : cameraState === "denied"
          ? t("camera.denied")
          : cameraState === "unavailable"
            ? t("camera.unavailable")
            : cameraState === "error"
              ? t("camera.error")
              : null;

  return (
    // One screen tall, whatever the phone: the shutter always sits in the thumb zone, above the tab bar.
    <div
      data-testid="capture"
      className="flex h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-var(--nav-height)-3rem)] min-h-[27rem] flex-col gap-3 lg:h-[min(80dvh,52rem)]"
    >
      {/* The phone's own camera and the photo library, opened by the buttons below. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={pick(false)}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />
      <input
        ref={libraryInput}
        type="file"
        accept="image/*"
        multiple={batch}
        onChange={pick(batch)}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />
      <h1 className="font-display text-[2rem] leading-none">{t("title")}</h1>
      <ModeBar value={mode} onChange={onMode} />
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-card bg-raised p-3 ring-1 ring-hairline"
        >
          <p className="text-small text-ink">{error}</p>
          {retry && (
            <Button size="sm" onClick={() => onFiles([retry])}>
              {t("tryAgain")}
            </Button>
          )}
        </div>
      )}

      {/* The viewfinder fills what is left; the controls float in its lower edge. */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[28px] bg-hero text-hero-ink shadow-raised">
        <video
          ref={attach}
          playsInline
          muted
          autoPlay
          aria-label={t("camera.preview")}
          data-state={cameraState}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-300",
            live ? "opacity-100" : "opacity-0",
          )}
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/55"
        />
        <FramingGuide className="inset-x-[14%] bottom-[28%] top-[16%] rounded-[28px] ring-1 ring-white/15" />
        <p className="absolute inset-x-6 top-3 text-center text-small text-hero-ink/90">
          {batch ? t("series.intro") : t("tips")}
        </p>
        {status && (
          <div
            role="status"
            className="absolute inset-x-8 top-1/2 flex -translate-y-1/2 flex-col items-center gap-3 text-center"
          >
            <p className="text-body text-hero-ink">{status}</p>
            {cameraState === "idle" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={start}
                className="bg-white/15 text-hero-ink hover:bg-white/25"
              >
                {t("camera.start")}
              </Button>
            )}
            {(cameraState === "denied" || cameraState === "error") && (
              <Button
                size="sm"
                variant="secondary"
                onClick={retryCamera}
                className="bg-white/15 text-hero-ink hover:bg-white/25"
              >
                {t("camera.retry")}
              </Button>
            )}
          </div>
        )}
        {flash > 0 && (
          <span
            key={flash}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-white opacity-0 motion-safe:animate-[shutter_220ms_ease-out]"
          />
        )}

        <div className="absolute inset-x-0 bottom-0 grid grid-cols-3 items-center px-5 pb-5 pt-3">
          <button
            type="button"
            onClick={() => libraryInput.current?.click()}
            className="grid size-12 place-items-center justify-self-start rounded-full bg-white/15 text-hero-ink backdrop-blur-md transition-transform duration-150 ease-cellr active:scale-95"
          >
            <PhotosIcon />
            <span className="sr-only">{batch ? t("series.choosePhotos") : t("choosePhoto")}</span>
          </button>
          <button
            type="button"
            onClick={() => void shoot()}
            aria-label={t("takePhoto")}
            data-testid="shutter"
            className="grid size-[4.75rem] place-items-center justify-self-center rounded-full ring-[3px] ring-white/85 transition-transform duration-150 ease-cellr active:scale-95"
          >
            <span className="block size-[3.9rem] rounded-full bg-hero-ink shadow-raised" />
          </button>
          {series.total > 0 ? (
            <a
              href="#series-title"
              aria-label={t("series.count", { done: series.done, total: series.total })}
              className="justify-self-end rounded-full bg-white/15 px-3 py-2 text-small font-semibold text-hero-ink backdrop-blur-md tnum"
            >
              {series.done}/{series.total}
            </a>
          ) : (
            <span />
          )}
        </div>
      </div>
      <p className="text-center text-caption text-ink-3">{t("privacy")}</p>
      <CatalogScanNote />
    </div>
  );
}

function PhotosIcon() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="1.75" />
      <path d="m21 16-5.5-5.5L6 20" />
    </svg>
  );
}

function Review({
  result,
  rejectedFound,
  wines,
  onReject,
  onWine,
  onAgain,
  batch,
}: {
  result: ScanResult;
  rejectedFound: boolean;
  wines: WineSummary[];
  onReject: () => void;
  onWine: (wine: WineSummary) => void;
  onAgain: () => void;
  /** A photo of a batch: back to the batch, or leave this photo out (nothing is added). */
  batch?: { onBack: () => void; onSkip: () => void } | undefined;
}) {
  const t = useTranslations("scan");
  const owned = useOwnedCounts();
  const [chosenNew, setChosenNew] = useState(false);
  // A wrong guess is corrected by finding the right wine among your own, not by typing it in again (a duplicate).
  const [searching, setSearching] = useState(false);
  const { outcome, facts, matches } = result;
  const [query, setQuery] = useState(facts?.producer ?? facts?.name ?? "");
  const wantsForm =
    chosenNew ||
    outcome === "new" ||
    outcome === "unread" ||
    (outcome === "found" && (rejectedFound || !matches[0]));
  const producers = [...new Set(wines.map((w) => w.producer))];
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
              <p className="mt-1 text-body text-ink-2">
                {t(result.remembered ? "rememberedBody" : "foundBody")}
              </p>
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

      {wantsForm && searching && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="font-display text-headline">{t("searchTitle")}</h2>
            <p className="mt-1 text-body text-ink-2">{t("searchBody")}</p>
          </div>
          <ChooseWine
            wines={wines}
            query={query}
            onQuery={setQuery}
            onPick={onWine}
            onNew={() => setSearching(false)}
          />
        </section>
      )}

      {wantsForm && !searching && (
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
          {wines.length > 0 && (
            <Button variant="secondary" size="lg" block onClick={() => setSearching(true)}>
              <SearchIcon size={18} />
              {t("searchMine")}
            </Button>
          )}
          <NewWineForm
            initialName=""
            draft={facts ? suggestWine(facts) : undefined}
            producers={producers}
            onCreated={onWine}
          />
          {!batch && (
            <Button variant="ghost" size="lg" block onClick={onAgain}>
              {t("tryAnother")}
            </Button>
          )}
        </section>
      )}

      {batch && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" size="lg" block onClick={batch.onBack}>
            {t("series.back")}
          </Button>
          <Button variant="ghost" size="lg" block onClick={batch.onSkip}>
            {t("series.skipPhoto")}
          </Button>
        </div>
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
