"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { preparePhoto, UnreadablePhotoError, type PreparedPhoto } from "@/lib/photo";
import { Button } from "@/ui/button";
import { FileButton } from "@/ui/file-button";
import { useToast } from "@/ui/toast";
import { attachBackLabel, type BackLabelAttempt } from "@/features/cellar/hooks";

/** A local preview of a photo not yet sent anywhere; made and revoked with the component that shows it. */
function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const made = URL.createObjectURL(blob);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- an object URL must be made and revoked with the component
    setUrl(made);
    return () => {
      URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [blob]);
  return url;
}

const THUMB = "h-28 w-20 shrink-0 overflow-hidden rounded-[12px] bg-raised ring-1 ring-hairline";

/**
 * Front and back, side by side, while confirming a scanned wine: the front is the photo just read; the back is
 * optional, kept on this device until the bottles are added (so leaving the scan uploads nothing), and can be
 * retaken or removed. No AI reads it.
 */
export function BackLabelPicker({
  frontImageId,
  value,
  onChange,
}: {
  frontImageId: string;
  value: PreparedPhoto | null;
  onChange: (next: PreparedPhoto | null) => void;
}) {
  const t = useTranslations("photo");
  const toast = useToast();
  const preview = useObjectUrl(value?.photo ?? null);
  const choose = async (file: File) => {
    try {
      onChange(await preparePhoto(file));
    } catch (e) {
      toast.show(e instanceof UnreadablePhotoError ? t("unreadable") : t("frameFailed"), {
        tone: "error",
      });
    }
  };
  return (
    <section
      aria-label={t("labelsTitle")}
      data-testid="scan-labels"
      className="flex items-center gap-3 rounded-card bg-surface p-3 shadow-raised ring-1 ring-hairline"
    >
      <figure className="flex flex-col items-center gap-1">
        <div className={THUMB}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the household's own photo, served privately */}
          <img
            src={`/api/v1/images/${frontImageId}?size=thumb`}
            alt={t("frontTitle")}
            className="size-full object-cover"
          />
        </div>
        <figcaption className="text-caption text-ink-2">{t("frontTitle")}</figcaption>
      </figure>
      <figure className="flex flex-col items-center gap-1">
        <div className={THUMB}>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview, not uploaded yet
            <img src={preview} alt={t("backTitle")} className="size-full object-cover" />
          ) : (
            <span aria-hidden="true" className="grid size-full place-items-center text-ink-3">
              +
            </span>
          )}
        </div>
        <figcaption className="text-caption text-ink-2">{t("backTitle")}</figcaption>
      </figure>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <p className="text-small text-ink-2">{value ? t("backReady") : t("backOptional")}</p>
        <div className="flex flex-wrap gap-2">
          <FileButton size="sm" variant="secondary" onFile={choose}>
            {value ? t("retakeBack") : t("addBack")}
          </FileButton>
          {value && (
            <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
              {t("removeBack")}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * After the bottles are in: what became of the back label. Saved says so; a wine that already had one asks
 * before replacing it; a failure offers to try again (the bottles are added either way).
 */
/** A back label that could not be saved during a series, tied to the wine (vintage) it was taken for. */
export interface BackRetry {
  key: string;
  vintageId: string;
  wine: string;
  photo: PreparedPhoto;
  imageId?: string | undefined;
}

/**
 * During a series, back labels that could not be saved stay listed here, each with its wine and "Try again"
 * (reusing the photo if it was already uploaded); the series itself goes on. An existing back label is never
 * replaced from here.
 */
export function BackLabelRetries({
  items,
  onChange,
}: {
  items: BackRetry[];
  onChange: (next: (items: BackRetry[]) => BackRetry[]) => void;
}) {
  const t = useTranslations("photo");
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  if (items.length === 0) return null;
  const retry = async (item: BackRetry) => {
    setBusy(item.key);
    const next = await attachBackLabel(item.vintageId, item.photo, { imageId: item.imageId });
    setBusy(null);
    if (next.outcome === "failed") {
      onChange((list) =>
        list.map((i) => (i.key === item.key ? { ...i, imageId: next.imageId ?? i.imageId } : i)),
      );
      toast.show(t("backFailedFor", { wine: item.wine }), { tone: "error" });
      return;
    }
    onChange((list) => list.filter((i) => i.key !== item.key));
    toast.show(next.outcome === "saved" ? t("backSaved") : t("backKeptFor", { wine: item.wine }));
    await queryClient.invalidateQueries({ queryKey: ["vintage"] });
  };
  return (
    <section
      role="status"
      data-testid="back-retries"
      className="mb-4 rounded-card bg-surface p-4 shadow-raised ring-1 ring-danger/40"
    >
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.key} data-testid="back-retry" className="flex flex-col gap-2">
            <p className="text-body text-ink">{t("backNotSavedFor", { wine: item.wine })}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                loading={busy === item.key}
                onClick={() => void retry(item)}
              >
                {t("backRetry")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === item.key}
                onClick={() => onChange((list) => list.filter((i) => i.key !== item.key))}
              >
                {t("backDismiss")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BackLabelResult({
  vintageId,
  photo,
  initial,
}: {
  vintageId: string;
  photo: PreparedPhoto;
  initial: BackLabelAttempt | "saving";
}) {
  const t = useTranslations("photo");
  const queryClient = useQueryClient();
  const [attempt, setAttempt] = useState<BackLabelAttempt | "saving" | "kept">(initial);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the outcome arrives after the screen is shown
    setAttempt(initial);
  }, [initial]);
  const state = typeof attempt === "string" ? attempt : attempt.outcome;
  // The photo once uploaded: a retry or a replace reuses it, never uploading a second copy.
  const [uploaded, setUploaded] = useState<string | undefined>(undefined);
  const known = typeof attempt === "string" ? uploaded : (attempt.imageId ?? uploaded);
  const attach = async (replace: boolean) => {
    setAttempt("saving");
    const next = await attachBackLabel(vintageId, photo, { replace, imageId: known });
    setUploaded(next.imageId ?? known);
    setAttempt(next);
    if (next.outcome === "saved") await queryClient.invalidateQueries({ queryKey: ["vintage"] });
  };
  return (
    <div
      role="status"
      data-testid="back-label-result"
      data-state={state}
      className="w-full rounded-card bg-surface p-4 text-left shadow-raised ring-1 ring-hairline"
    >
      {state === "saving" && <p className="text-body text-ink-2">{t("backSaving")}</p>}
      {state === "saved" && <p className="text-body text-ink">{t("backSaved")}</p>}
      {state === "kept" && <p className="text-body text-ink-2">{t("backKept")}</p>}
      {state === "exists" && (
        <>
          <p className="text-body text-ink">{t("backExists")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void attach(true)}>
              {t("backReplace")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAttempt("kept")}>
              {t("backKeep")}
            </Button>
          </div>
        </>
      )}
      {state === "failed" && (
        <>
          <p className="text-body text-danger">{t("backFailed")}</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => void attach(false)}>
            {t("backRetry")}
          </Button>
        </>
      )}
    </div>
  );
}
