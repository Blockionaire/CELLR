"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  BOTTLE_PHOTO_MAX,
  contributionView,
  ERROR_MESSAGES,
  type BottlePhotoResult,
  type ContributionState,
} from "@cellr/domain";
import { api, ApiError, errorMessage } from "@/lib/api";
import { preparePhoto, UnreadablePhotoError } from "@/lib/photo";
import { Button } from "@/ui/button";
import { FileButton } from "@/ui/file-button";
import { Sheet } from "@/ui/sheet";

interface Picked {
  file: File;
  url: string;
}

/** Where I stand with a wine's bottle photos (any vintage), read from the server: the same on every device. */
export const contributionKey = (wineId: string) => ["bottle-photo-status", wineId] as const;

export function useContributionStatus(wineId: string) {
  return useQuery({
    queryKey: contributionKey(wineId),
    queryFn: async (): Promise<ContributionState | null> => {
      const { items } = await api.get<{ items: ContributionState[] | null }>(
        `/bottle-photos/status?wine=${encodeURIComponent(wineId)}`,
      );
      return items?.find((s) => s.wineId === wineId) ?? null;
    },
    staleTime: 60_000,
  });
}

/**
 * Sends one contribution of 1 to 3 bottle photos with the explicit yes. Afterwards (sent, or refused because one was
 * already sent) my points and every contribution status are read again, and Home's invitation with them.
 */
function useSendBottlePhoto() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const settle = () => {
    void queryClient.invalidateQueries({ queryKey: ["points"] });
    void queryClient.invalidateQueries({ queryKey: ["bottle-photo-status"] });
    router.refresh();
  };
  return useMutation({
    mutationFn: async ({ vintageId, files }: { vintageId: string; files: File[] }) => {
      const prepared = await Promise.all(files.map((f) => preparePhoto(f)));
      const form = new FormData();
      prepared.forEach((p, i) => form.append("photo", p.photo, `bottle-${i + 1}.jpg`));
      form.set("vintageId", vintageId);
      form.set("consent", "true");
      return api.upload<BottlePhotoResult>("/bottle-photos", form);
    },
    onSuccess: settle,
    onError: (e) => {
      if (e instanceof ApiError && e.code === "CONFLICT") settle();
    },
  });
}

/**
 * The sheet itself: 1 to 3 photos (the whole bottle, the labels close up), sent together with one explicit yes that
 * CELLR may use them to make and show a 2D bottle picture of this wine. The photos themselves are never shown in the
 * app. Opened by the wine page, Home's invitation and the bottle-added screen alike.
 */
export function BottlePhotoSheet({
  open,
  onClose,
  vintageId,
  wine,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  vintageId: string;
  wine: string;
  /** Called once the photos are sent and recorded. */
  onSent?: () => void;
}) {
  const t = useTranslations("bottlePhoto");
  const te = useTranslations();
  const send = useSendBottlePhoto();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<BottlePhotoResult | null>(null);

  // each preview's local address goes when its photo does (removed, sent, the sheet closed or the page left)
  const urls = useRef<Picked[]>([]);
  useEffect(() => {
    urls.current = picked;
  }, [picked]);
  useEffect(() => () => urls.current.forEach((p) => URL.revokeObjectURL(p.url)), []);
  const drop = (gone: Picked[]) => gone.forEach((p) => URL.revokeObjectURL(p.url));

  const close = () => {
    onClose();
    drop(picked);
    setPicked([]);
    setConsent(false);
    setError(null);
    setDone(null);
  };

  async function submit() {
    if (picked.length === 0 || !consent || send.isPending) return;
    setError(null);
    try {
      setDone(await send.mutateAsync({ vintageId, files: picked.map((p) => p.file) }));
      onSent?.();
      drop(picked);
      setPicked([]);
    } catch (e) {
      // the photos and the yes stay, so sending can simply be tried again
      setError(
        e instanceof UnreadablePhotoError
          ? t("unreadable")
          : e instanceof ApiError && e.code === "CONFLICT"
            ? t("alreadySent")
            : errorMessage(e, (k) => te(k), ERROR_MESSAGES),
      );
    }
  }

  return (
    <Sheet open={open} onClose={close} title={t("sheetTitle")}>
      {done ? (
        <div
          className="flex flex-col items-center gap-3 text-center"
          data-testid="bottle-photo-done"
        >
          <span
            aria-hidden="true"
            className="grid size-14 place-items-center rounded-full bg-accent text-accent-ink font-display text-headline"
          >
            ✓
          </span>
          <p className="font-display text-headline text-ink">{t("thanks")}</p>
          <p className="text-body text-ink-2 text-pretty">
            {done.points > 0 ? t("earned", { points: done.points }) : t("alreadyEarned")}
          </p>
          {done.total !== null && (
            <p className="text-small text-ink-3" data-testid="points-total">
              {t("total", { points: done.total })}
            </p>
          )}
          <Button block onClick={close}>
            {t("close")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-body text-ink-2 text-pretty">{t("body", { wine })}</p>
          <ul className="list-disc pl-5 text-small text-ink-2">
            <li>{t("tipWhole")}</li>
            <li>{t("tipLight")}</li>
            <li>{t("tipBackground")}</li>
            <li>{t("tipMore")}</li>
          </ul>
          {picked.length > 0 && (
            <ul className="grid grid-cols-3 gap-2" data-testid="bottle-photo-previews">
              {picked.map((p, i) => (
                <li key={p.url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local preview, not sent yet */}
                  <img
                    src={p.url}
                    alt={t("previewAlt", { n: i + 1 })}
                    className="aspect-[3/4] w-full rounded-[12px] bg-raised object-cover"
                  />
                  <button
                    type="button"
                    aria-label={t("remove")}
                    onClick={() => {
                      drop([p]);
                      setPicked((all) => all.filter((x) => x !== p));
                    }}
                    className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-canvas/90 text-small text-ink ring-1 ring-hairline"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {picked.length < BOTTLE_PHOTO_MAX && (
            <FileButton
              variant={picked.length ? "ghost" : "secondary"}
              block
              accept="image/*"
              onFile={(file) => {
                setError(null);
                setPicked((all) =>
                  all.length >= BOTTLE_PHOTO_MAX
                    ? all
                    : [...all, { file, url: URL.createObjectURL(file) }],
                );
              }}
            >
              {picked.length
                ? t("another", { count: picked.length + 1, max: BOTTLE_PHOTO_MAX })
                : t("choose")}
            </FileButton>
          )}
          <label className="flex items-start gap-3 rounded-[14px] bg-raised p-3 text-small text-ink">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
            />
            <span>{t("consent")}</span>
          </label>
          <p className="text-caption text-ink-3">{t("privacy")}</p>
          {error && (
            <p role="alert" className="text-small text-danger">
              {error}
            </p>
          )}
          <Button
            block
            disabled={picked.length === 0 || !consent}
            loading={send.isPending}
            onClick={() => void submit()}
          >
            {t("send", { count: Math.max(1, picked.length) })}
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/** "+10 points", only for someone the ledger has not rewarded for this wine yet. */
export function RewardPill({ points }: { points: number }) {
  const t = useTranslations("bottlePhoto");
  return (
    <span className="inline-flex items-center rounded-full bg-accent/15 px-2.5 py-0.5 text-caption font-semibold text-accent-fg tnum">
      {t("reward", { points })}
    </span>
  );
}

/**
 * Helping CELLR picture a wine, on the wine's page, by where I stand with it: the request (with the one-time reward
 * when it is still to be earned), a quiet "photos received" once I sent some (with what I actually earned), a renewed
 * request after a rejection, nothing once the wine has a picture.
 */
export function BottlePhotoContribution({
  vintageId,
  wineId,
  wine,
}: {
  vintageId: string;
  wineId: string;
  wine: string;
}) {
  const t = useTranslations("bottlePhoto");
  const status = useContributionStatus(wineId);
  const [open, setOpen] = useState(false);
  // while the status is read, nothing: a request that disappears a moment later would be worse
  if (status.isPending) return null;
  const view = contributionView(status.data ?? null);
  const sheet = (
    <BottlePhotoSheet
      open={open}
      onClose={() => setOpen(false)}
      vintageId={vintageId}
      wine={wine}
    />
  );
  // Always in the same place beside what is shown, so it keeps its state (and its thank-you) when that changes.
  const content =
    view.show === "none" ? null : view.show === "received" ? (
      <div data-testid="bottle-photo-received">
        <p className="text-body text-ink">{t("receivedTitle")}</p>
        <p className="text-small text-ink-2">
          {t("receivedBody")}
          {view.earned > 0 && <> {t("receivedPoints", { points: view.earned })}</>}
        </p>
      </div>
    ) : (
      <div data-testid="bottle-photo-ask" data-state={view.show}>
        <p className="flex flex-wrap items-center gap-2 text-body text-ink">
          {view.show === "again" ? t("againTitle") : t("title")}
          {view.reward !== null && <RewardPill points={view.reward} />}
        </p>
        <p className="text-small text-ink-2">
          {view.show === "again" ? t("againBody") : t("teaser")}
          {view.show === "again" && view.earned > 0 && <> {t("againNoPoints")}</>}
        </p>
        <Button className="mt-2" size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {t("open")}
        </Button>
      </div>
    );
  return (
    <>
      {content}
      {sheet}
    </>
  );
}

/**
 * After bottles were added: an optional, clearly separate offer to send whole-bottle photos (not the label photo of a
 * scan), only to someone who has sent nothing for this wine and was never rewarded for it, and only once the status
 * is known (it never holds the screen up). Gone once sent.
 */
export function BottlePhotoOffer({
  vintageId,
  wineId,
  wine,
}: {
  vintageId: string;
  wineId: string;
  wine: string;
}) {
  const t = useTranslations("bottlePhoto");
  const status = useContributionStatus(wineId);
  const [open, setOpen] = useState(false);
  const view = contributionView(status.data ?? null);
  // the sheet stays while open, so its thank-you is seen even though the status changes underneath it
  if (!open && (!status.isSuccess || !view.invite)) return null;
  return (
    <div
      className="reveal w-full max-w-sm rounded-card bg-raised/60 p-4 text-left [--i:7]"
      data-testid="bottle-photo-offer"
    >
      <p className="flex flex-wrap items-center gap-2 text-body font-medium text-ink">
        {t("addedTitle")}
        {view.reward !== null && <RewardPill points={view.reward} />}
      </p>
      <p className="mt-0.5 text-small text-ink-2">{t("addedBody")}</p>
      <Button className="mt-3" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t("addedCta")}
      </Button>
      <BottlePhotoSheet
        open={open}
        onClose={() => setOpen(false)}
        vintageId={vintageId}
        wine={wine}
      />
    </div>
  );
}
