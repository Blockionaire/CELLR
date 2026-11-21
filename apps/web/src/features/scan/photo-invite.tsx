"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  BOTTLE_PHOTO_MAX,
  contributionView,
  ERROR_MESSAGES,
  type AddBottlesResult,
  type BottlePhotoResult,
  type ContributionState,
} from "@cellr/domain";
import {
  contributionKey,
  PhotoPicker,
  RewardPill,
  useSendBottlePhoto,
  type PickedPhoto,
} from "@/features/cellar/bottle-photo";
import { track } from "@/lib/analytics";
import { api, ApiError, errorMessage } from "@/lib/api";
import { UnreadablePhotoError } from "@/lib/photo";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";

/**
 * "Make your bottle visible in CELLR" (Unified Scan, PR 3): while the scan is reviewed, an optional invitation to
 * take 1 to 3 photos of the whole bottle for the 2D bottle library. Never a step: the bottles are added whatever is
 * done with it. The photos chosen stay on the device (their previews are local) until the bottles are saved, and are
 * then sent with the explicit yes given here, to the vintage just added (see `sendKeptPhotos`). Nothing is sent for a
 * wine that has a picture already, or that the person sent photos of before.
 */

/** Steps of the invitation, for the analytics event (words only: never a wine, a photo or a person). */
export type InviteStep = "shown" | "accepted" | "later" | "kept" | "sent" | "failed" | "not_needed";

export const trackInvite = (
  step: InviteStep,
  props: { photos?: number; wine?: "existing" | "new"; mode?: string } = {},
) =>
  track("bottle_photo_invite", {
    step,
    ...(props.photos !== undefined ? { photos: props.photos } : {}),
    ...(props.wine ? { wine: props.wine } : {}),
    ...(props.mode ? { mode: props.mode } : {}),
  });

/** Where I stand with a wine's bottle photos, asked only when there is a wine to ask about. */
function useStatusOf(wineId: string | null) {
  return useQuery({
    queryKey: contributionKey(wineId ?? "none"),
    queryFn: async (): Promise<ContributionState | null> => {
      const { items } = await api.get<{ items: ContributionState[] | null }>(
        `/bottle-photos/status?wine=${encodeURIComponent(wineId!)}`,
      );
      return items?.find((s) => s.wineId === wineId) ?? null;
    },
    enabled: wineId !== null,
    staleTime: 60_000,
  });
}

/**
 * The invitation on the review. `wine`: the wine chosen ("new": one that will be created with the bottles; null: not
 * chosen yet, nothing shown). `hasArt`: the wine found already has a published picture. `open`: this scan flow has not
 * answered the invitation yet ("Maybe later", or photos sent): once answered it is not asked again in the flow.
 */
export function ScanPhotoInvite({
  wine,
  hasArt,
  open,
  kept,
  onKeep,
  onStep,
}: {
  wine: { id: string } | "new" | null;
  hasArt: boolean;
  open: boolean;
  /** Photos chosen here and kept for after the save (with the yes). */
  kept: PickedPhoto[];
  onKeep: (photos: PickedPhoto[]) => void;
  /** A step of the invitation, with how many photos are kept by it. */
  onStep: (step: InviteStep, photos: number) => void;
}) {
  const t = useTranslations("scanPhotoInvite");
  const status = useStatusOf(wine && wine !== "new" ? wine.id : null);
  const [sheet, setSheet] = useState(false);
  const view = contributionView(status.data ?? null);
  const eligible = wine === "new" || (wine !== null && !hasArt && status.isSuccess && view.invite);
  const visible = kept.length > 0 || (open && eligible);

  const shown = useRef(false);
  useEffect(() => {
    if (visible && !shown.current && kept.length === 0) {
      shown.current = true;
      onStep("shown", 0);
    }
  }, [visible, kept.length, onStep]);

  if (!visible && !sheet) return null;
  return (
    <section
      aria-labelledby="scan-photo-invite"
      data-testid="scan-photo-invite"
      data-state={kept.length > 0 ? "kept" : "ask"}
      className="flex flex-col gap-3 rounded-card bg-raised/60 p-4 ring-1 ring-hairline"
    >
      <div>
        <h3
          id="scan-photo-invite"
          className="flex flex-wrap items-center gap-2 text-body font-medium text-ink"
        >
          {t("title")}
          {wine !== "new" && view.reward !== null && kept.length === 0 && (
            <RewardPill points={view.reward} />
          )}
        </h3>
        <p className="mt-0.5 text-small text-ink-2">
          {kept.length > 0 ? t("keptBody", { count: kept.length }) : t("body")}
        </p>
      </div>
      {kept.length > 0 && (
        <ul className="grid grid-cols-3 gap-2" data-testid="scan-photo-kept">
          {kept.map((p, i) => (
            <li key={p.url}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local preview, not sent yet */}
              <img
                src={p.url}
                alt={t("previewAlt", { n: i + 1 })}
                className="aspect-[3/4] w-full rounded-[12px] bg-raised object-cover"
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            if (kept.length === 0) onStep("accepted", 0);
            setSheet(true);
          }}
        >
          {kept.length > 0 ? t("change") : t("take")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (kept.length > 0) onKeep([]);
            onStep("later", 0);
          }}
        >
          {kept.length > 0 ? t("removeAll") : t("later")}
        </Button>
      </div>
      <KeepPhotosSheet
        open={sheet}
        initial={kept}
        onClose={() => setSheet(false)}
        onKeep={(photos) => {
          onKeep(photos);
          onStep("kept", photos.length);
          setSheet(false);
        }}
      />
    </section>
  );
}

/** The same choosing as the wine page's sheet, but nothing is sent: the photos are kept for after the save. */
function KeepPhotosSheet({
  open,
  initial,
  onClose,
  onKeep,
}: {
  open: boolean;
  initial: PickedPhoto[];
  onClose: () => void;
  onKeep: (photos: PickedPhoto[]) => void;
}) {
  const t = useTranslations("scanPhotoInvite");
  return (
    <Sheet open={open} onClose={onClose} title={t("sheetTitle")}>
      {open && <KeepPhotosBody initial={initial} onKeep={onKeep} />}
    </Sheet>
  );
}

function KeepPhotosBody({
  initial,
  onKeep,
}: {
  initial: PickedPhoto[];
  onKeep: (photos: PickedPhoto[]) => void;
}) {
  const t = useTranslations("scanPhotoInvite");
  const [picked, setPicked] = useState<PickedPhoto[]>(initial);
  // photos kept before are already agreed to; new ones are agreed to again with them
  const [consent, setConsent] = useState(initial.length > 0);
  return (
    <div className="flex flex-col gap-4" data-testid="scan-photo-sheet">
      <p className="text-body text-ink-2 text-pretty">{t("sheetBody")}</p>
      <PhotoPicker
        picked={picked}
        onPicked={setPicked}
        // a removed photo's preview is released when the review is left (it may still be the one kept)
        onDrop={() => undefined}
        consent={consent}
        onConsent={setConsent}
      />
      <Button
        block
        disabled={picked.length === 0 || picked.length > BOTTLE_PHOTO_MAX || !consent}
        onClick={() => onKeep(picked)}
      >
        {t("keep", { count: Math.max(1, picked.length) })}
      </Button>
    </div>
  );
}

/** What became of the photos kept with a scan, once the bottles were added. */
export type SendOutcome =
  | { state: "sending" }
  | { state: "sent"; result: BottlePhotoResult }
  | { state: "not_needed" }
  | { state: "failed"; message: string };

/** What a send ended in (never still "sending"). */
export type SendResult = Exclude<SendOutcome, { state: "sending" }>;

/**
 * Sends the photos kept with a scan, now that its bottles are saved: to the vintage just added, with the yes given on
 * the review. First asks where the person stands with the wine (the wine may turn out to be one with a picture, or
 * one they sent photos of before: the server keeps one wine per identity), and then sends nothing. A failure leaves
 * the bottles as they are and the photos on the device, to try again.
 */
export function useSendKeptPhotos() {
  const send = useSendBottlePhoto();
  const te = useTranslations();
  const t = useTranslations("bottlePhoto");
  return async (added: AddBottlesResult, files: File[]): Promise<SendResult> => {
    try {
      const { items } = await api.get<{ items: ContributionState[] | null }>(
        `/bottle-photos/status?wine=${encodeURIComponent(added.wine.id)}`,
      );
      const now = items?.find((s) => s.wineId === added.wine.id) ?? null;
      if (now && (now.status === "published" || now.status === "submitted"))
        return { state: "not_needed" };
      return {
        state: "sent",
        result: await send.mutateAsync({ vintageId: added.vintageId, files }),
      };
    } catch (e) {
      // already sent (an earlier try that did arrive): nothing more to do
      if (e instanceof ApiError && e.code === "CONFLICT") return { state: "not_needed" };
      return {
        state: "failed",
        message:
          e instanceof UnreadablePhotoError
            ? t("unreadable")
            : errorMessage(e, (k) => te(k), ERROR_MESSAGES),
      };
    }
  };
}

/** On the "added" screen: the photos are on their way, sent (with the points, if earned), or can be tried again. */
export function KeptPhotosResult({
  outcome,
  onRetry,
}: {
  outcome: SendOutcome;
  onRetry: () => void;
}) {
  const t = useTranslations("scanPhotoInvite");
  const tp = useTranslations("bottlePhoto");
  return (
    <div
      role="status"
      data-testid="scan-photo-result"
      data-state={outcome.state}
      className="w-full max-w-sm rounded-card bg-raised/60 p-4 text-left"
    >
      {outcome.state === "sending" && <p className="text-body text-ink">{t("sending")}</p>}
      {outcome.state === "sent" && (
        <>
          <p className="text-body font-medium text-ink">{tp("thanks")}</p>
          <p className="mt-0.5 text-small text-ink-2">
            {outcome.result.points > 0
              ? tp("earned", { points: outcome.result.points })
              : t("sentNoPoints")}
          </p>
        </>
      )}
      {outcome.state === "not_needed" && <p className="text-small text-ink-2">{t("notNeeded")}</p>}
      {outcome.state === "failed" && (
        <>
          <p className="text-body text-ink">{t("failed")}</p>
          <p className="mt-0.5 text-small text-ink-2">{outcome.message}</p>
          <Button className="mt-3" size="sm" variant="secondary" onClick={onRetry}>
            {t("retry")}
          </Button>
        </>
      )}
    </div>
  );
}

/** Bottle photos of a batch that could not be sent, each with its own wine, until sent or let go. */
export interface PhotoRetry {
  key: string;
  added: AddBottlesResult;
  files: File[];
  wine: string;
}

export function KeptPhotoRetries({
  items,
  onChange,
  mode,
}: {
  items: PhotoRetry[];
  onChange: (update: (list: PhotoRetry[]) => PhotoRetry[]) => void;
  mode: string;
}) {
  const t = useTranslations("scanPhotoInvite");
  const sendKept = useSendKeptPhotos();
  const [busy, setBusy] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <ul className="mb-4 flex flex-col gap-2" data-testid="scan-photo-retries">
      {items.map((item) => (
        <li
          key={item.key}
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-raised p-3 ring-1 ring-hairline"
        >
          <p className="min-w-0 text-small text-ink">{t("retryFor", { wine: item.wine })}</p>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={busy === item.key}
              onClick={async () => {
                if (busy) return;
                setBusy(item.key);
                const outcome = await sendKept(item.added, item.files);
                setBusy(null);
                if (outcome.state === "failed") return trackInvite("failed", { mode });
                trackInvite(outcome.state, { photos: item.files.length, mode });
                onChange((list) => list.filter((x) => x.key !== item.key));
              }}
            >
              {t("retry")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange((list) => list.filter((x) => x.key !== item.key))}
            >
              {t("dismiss")}
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}
