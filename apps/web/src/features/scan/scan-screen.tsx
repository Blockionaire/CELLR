"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  ERROR_MESSAGES,
  formatVintage,
  MATCH,
  matchLabel,
  scoreWine,
  type AddBottlesResult,
  type ScanResult,
  type WineSummary,
} from "@cellr/domain";
import { CatalogScanNote } from "@/features/account/catalog-section";
import { AddedDone } from "@/features/cellar/added-done";
import type { PreferredSpot } from "@/features/cellar/add-spot";
import {
  attachBackLabel,
  useWines,
  winesKey,
  type BackLabelAttempt,
} from "@/features/cellar/hooks";
import { ApiError, errorMessage } from "@/lib/api";
import { UnreadablePhotoError, type PreparedPhoto } from "@/lib/photo";
import { Button } from "@/ui/button";
import { cn } from "@/ui/cn";
import { PageHeader } from "@/ui/page-header";
import { useToast } from "@/ui/toast";
import { useCamera, type Camera } from "./camera";
import { BackLabelPicker, BackLabelResult, BackLabelRetries, type BackRetry } from "./back-label";
import { useScan } from "./hooks";
import { warmOcr } from "./ocr";
import { ModeBar, type ScanMode } from "./modes";
import {
  KeptPhotoRetries,
  KeptPhotosResult,
  trackInvite,
  useSendKeptPhotos,
  type PhotoRetry,
  type SendOutcome,
} from "./photo-invite";
import { ScanReview } from "./scan-review";
import { SeriesTray, useScanSeries, type SeriesItem } from "./series";

type Stage =
  | { name: "capture"; error: string | null; retry: File | null }
  | { name: "reading"; preview: string }
  // `itemId`: the photo came from a series (several bottles in a row), see series.tsx
  | { name: "review"; result: ScanResult; itemId?: string | undefined }
  | {
      name: "done";
      result: AddBottlesResult;
      /** A back label taken with this scan, and what became of it. */
      back?: { photo: PreparedPhoto; outcome: BackLabelAttempt | "saving" } | undefined;
      /** Bottle photos kept on the review for the 2D library, and what became of them. */
      photos?: { files: File[]; outcome: SendOutcome } | undefined;
    };

/**
 * Scan a label: take a photo, we read it, you check it, the bottles are added with the photo on them. The
 * photo is kept the moment it is taken, so whatever goes wrong afterwards (no AI, no connection, a label that
 * cannot be read) never costs the person their picture: the wine can always be filled in by hand beside it.
 */
export function ScanScreen({
  currency,
  initialSpot,
  catalogSearch = false,
}: {
  currency: string;
  /** From "add a bottle here" in a rack: the first bottle scanned goes on that spot (unless changed). */
  initialSpot?: PreferredSpot | undefined;
  /** The `wine_search` feature: correcting a reading searches the database, not only the fetched list. */
  catalogSearch?: boolean | undefined;
}) {
  const t = useTranslations("scan");
  const tAdd = useTranslations("addBottle");
  const te = useTranslations();
  const scan = useScan();
  const wines = useWines();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<ScanMode>("single");
  // In a series the place chosen for one bottle is offered for the next.
  const [lastPlace, setLastPlace] = useState<string | null | undefined>(undefined);
  // The rack spot this scan was started from; used once, by the first bottle added.
  const [spot, setSpot] = useState<PreferredSpot | null>(initialSpot ?? null);
  const [stage, setStage] = useState<Stage>({ name: "capture", error: null, retry: null });
  // An optional back label, tied to the front photo it was taken with: it can never go on to another wine.
  const [back, setBack] = useState<{ imageId: string; photo: PreparedPhoto } | null>(null);
  const backFor = (imageId: string) => (back?.imageId === imageId ? back.photo : null);
  // The back label last chosen for a front photo, as a promise: it is made ready in the background (opened, resized),
  // which takes a phone a moment. This, not `back` (which is for showing it), is what "Add" goes by: tapped while the
  // photo is still being made ready, or just before it is, the bottles go in at once and the label follows, instead
  // of being left out without a word.
  const backChoice = useRef<{ imageId: string; ready: Promise<PreparedPhoto | null> } | null>(null);
  // Back labels of a series that could not be saved, each tied to its own wine, until retried or dismissed.
  const [backRetries, setBackRetries] = useState<BackRetry[]>([]);
  // The invitation to send bottle photos is made once per scan flow: once it has been on a review that is finished
  // (added, wished, skipped), or answered, it is not made again here.
  const [inviteOpen, setInviteOpen] = useState(true);
  const [inviteShown, setInviteShown] = useState(false);
  const closeInvite = () => {
    if (inviteShown) setInviteOpen(false);
  };
  const [photoRetries, setPhotoRetries] = useState<PhotoRetry[]>([]);
  const sendKept = useSendKeptPhotos();
  const flowMode = (itemId?: string) => (itemId ? "batch" : mode);

  /** Sends the photos kept on a review now that its bottles are in; the outcome is said where the person is. */
  async function sendPhotos(result: AddBottlesResult, files: File[], itemId?: string) {
    const outcome = await sendKept(result, files);
    trackInvite(outcome.state, {
      photos: files.length,
      mode: flowMode(itemId),
    });
    if (!itemId) {
      setStage((s) =>
        s.name === "done" && s.result === result && s.photos
          ? { ...s, photos: { files, outcome } }
          : s,
      );
      return;
    }
    const wine = `${result.wine.producer} ${result.wine.name}`;
    if (outcome.state === "sent") toast.show(t("photoSentFor", { wine }));
    if (outcome.state === "failed")
      setPhotoRetries((list) => [
        ...list,
        { key: `${result.vintageId}:${Date.now()}`, added: result, files, wine },
      ]);
  }
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
  // The on-device label reader loads in the background once the camera had its moment (Sprint S); the first photo
  // never waits for it longer than its budget.
  useEffect(() => {
    const timer = setTimeout(() => void warmOcr(), 300);
    return () => clearTimeout(timer);
  }, []);

  /**
   * A photo read a while ago is matched again against the wines as they are now: a wine added from an earlier
   * photo of this batch is then found, instead of being offered as a new wine a second time.
   */
  const current = (result: ScanResult): ScanResult => {
    // Read from the cache, not this render: right after a wine is added, the list is fresher there.
    const list = queryClient.getQueryData<WineSummary[]>(winesKey) ?? wines.data;
    // A remembered photo already names the wine this household confirmed for it; a label-text match names the
    // catalogue wine (or the household's own wine linked to it) the server checked against the household's wines.
    if (
      !result.facts ||
      result.outcome === "unread" ||
      result.remembered ||
      result.fromText ||
      !list
    )
      return result;
    // The resolver's answer (WI-03) came from a bounded lookup on the server. It is matched again only against its
    // own candidates plus the household's own wines as they are now (a wine added from an earlier photo of this
    // batch), never against the whole catalogue; and only when that changes something is its "why" let go.
    if (result.resolution) {
      const own = list.filter((w) => !w.catalog);
      const known = new Set(result.matches.map((m) => m.wine.id));
      if (own.every((w) => known.has(w.id) || scoreWine(result.facts!, w) < MATCH.maybe))
        return result;
      const again = matchLabel(result.facts, [
        ...result.matches.map((m) => m.wine),
        ...own.filter((w) => !known.has(w.id)),
      ]);
      // matched again here: the server's status and reasons no longer describe this answer, so they are let go
      const { resolution: _stale, ...rest } = result;
      void _stale;
      return { ...rest, ...again };
    }
    return { ...result, ...matchLabel(result.facts, list) };
  };

  /** A batch photo to look at, on the same one-screen review as a single scan (matched again against the wines now). */
  function open(item: SeriesItem) {
    if (!item.result) return;
    setStage({ name: "review", result: current(item.result), itemId: item.id });
  }

  async function addToBatch(files: File[]) {
    const { refused } = await series.queue.add(files);
    if (refused > 0) toast.show(t("series.full", { count: refused }));
  }

  async function read(file: File) {
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
    const item = series.queue.nextReady(afterId);
    if (item) open(item);
    else setStage({ name: "capture", error: null, retry: null });
  }

  function skip(itemId: string) {
    closeInvite();
    series.queue.skip(itemId);
    toast.show(t("series.skipped"));
    next(itemId);
  }

  const restart = () => {
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
          <PageHeader title={stage.name === "done" ? tAdd("savedTitle") : t("title")} />
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

        <BackLabelRetries items={backRetries} onChange={setBackRetries} />
        <KeptPhotoRetries items={photoRetries} onChange={setPhotoRetries} mode="batch" />

        {stage.name === "review" && (
          <ScanReview
            // A fresh review per photo: going straight on to the next one never carries its vintage over. Choosing
            // another wine on it keeps everything typed (the key is the photo, not the wine).
            key={stage.result.image.id}
            result={stage.result}
            wines={wines.data ?? []}
            catalogSearch={catalogSearch}
            currency={currency}
            mode={mode}
            inBatch={!!stage.itemId}
            preferredPlaceId={spot ? spot.locationId : stage.itemId ? lastPlace : undefined}
            spot={spot}
            onSpotChange={setSpot}
            labels={
              <BackLabelPicker
                frontImageId={stage.result.image.id}
                value={backFor(stage.result.image.id)}
                onChange={(photo) => {
                  const imageId = stage.result.image.id;
                  const current = backChoice.current?.imageId === imageId;
                  // Ready: shown, unless its bottles were added meanwhile (then it has gone with them) or another
                  // label is on screen by now. Removed: nothing follows the bottles any more.
                  if (photo && !current) return;
                  if (!photo && current) backChoice.current = null;
                  setBack(photo ? { imageId, photo } : null);
                }}
                onPreparing={(ready) => {
                  backChoice.current = { imageId: stage.result.image.id, ready };
                }}
              />
            }
            photoInvite={inviteOpen}
            onInviteStep={(step, wine, photos) => {
              trackInvite(step, { wine, photos, mode: flowMode(stage.itemId) });
              if (step === "shown") setInviteShown(true);
              if (step === "later") setInviteOpen(false);
            }}
            onWished={(wine) => {
              closeInvite();
              if (stage.itemId)
                handled(
                  stage.itemId,
                  t("series.wished", { wine: `${wine.producer} ${wine.name}` }),
                  true, // the wishlist has said so already
                );
              else restart();
            }}
            onAgain={restart}
            batch={
              stage.itemId
                ? {
                    onBack: () => setStage({ name: "capture", error: null, retry: null }),
                    onSkip: () => skip(stage.itemId!),
                  }
                : undefined
            }
            onDone={(result, placeId, photos) => {
              closeInvite();
              if (photos.length > 0) {
                setInviteOpen(false);
                void sendPhotos(result, photos, stage.itemId);
              }
              // The bottles are in. The back label (if any) follows on its own: whatever happens to it, the
              // bottles stay added, and the photo is only uploaded now, so leaving earlier left nothing behind.
              const shown = backFor(stage.result.image.id);
              const choice =
                backChoice.current?.imageId === stage.result.image.id
                  ? backChoice.current.ready
                  : null;
              backChoice.current = null;
              setBack(null);
              // The photo to put on: the one chosen last, when it is ready (if it cannot be read, the one that was
              // shown before it).
              const coming = choice?.then((photo) => photo ?? shown) ?? null;
              setSpot(null);
              if (!stage.itemId) {
                setStage({
                  name: "done",
                  result,
                  back: coming && shown ? { photo: shown, outcome: "saving" } : undefined,
                  photos:
                    photos.length > 0
                      ? { files: photos, outcome: { state: "sending" } }
                      : undefined,
                });
                void coming?.then(async (photo) => {
                  if (!photo) return;
                  if (photo !== shown)
                    setStage((s) =>
                      s.name === "done" && s.result === result
                        ? { ...s, back: { photo, outcome: "saving" } }
                        : s,
                    );
                  const outcome = await attachBackLabel(result.vintageId, photo);
                  setStage((s) =>
                    s.name === "done" && s.result === result && s.back
                      ? { ...s, back: { ...s.back, outcome } }
                      : s,
                  );
                });
                return;
              }
              // In a series nothing waits: an existing back label is kept; a failure stays listed with its
              // wine and "Try again" until it is saved or dismissed.
              void coming?.then(async (photo) => {
                if (!photo) return;
                const { outcome, imageId } = await attachBackLabel(result.vintageId, photo);
                const wine = `${result.wine.producer} ${result.wine.name} ${formatVintage(result.year)}`;
                if (outcome === "exists") toast.show(te("photo.backKeptFor", { wine }));
                if (outcome === "failed")
                  setBackRetries((list) => [
                    ...list,
                    {
                      key: `${result.vintageId}:${Date.now()}`,
                      vintageId: result.vintageId,
                      wine,
                      photo,
                      imageId,
                    },
                  ]);
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
        {stage.name === "done" && stage.photos && (
          <div className="mb-4 flex justify-center">
            <KeptPhotosResult
              outcome={stage.photos.outcome}
              onRetry={() => {
                const { result, photos } = stage;
                if (!photos) return;
                setStage((s) =>
                  s.name === "done" && s.result === result
                    ? { ...s, photos: { files: photos.files, outcome: { state: "sending" } } }
                    : s,
                );
                void sendPhotos(result, photos.files);
              }}
            />
          </div>
        )}
        {stage.name === "done" && (
          <AddedDone
            result={stage.result}
            onAnother={restart}
            anotherLabel={t("another")}
            hasPhoto
            // the invitation was made on the review already: not a second time here
            photoOffer={!inviteShown}
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
